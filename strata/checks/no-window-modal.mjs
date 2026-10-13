/**
 * 约束 id: no-window-modal（面：层 X,V,O × 全部域）
 *
 * 契约：exit 0 = 通过 / 1 = 失败 / 2 = 无法判定
 *
 * 规则：`.vue` 里不得出现原生模态 `window.confirm` / `window.alert` / `window.prompt`。
 *
 * 理由（为什么值得一条约束）：原生模态会**阻塞主线程**（弹窗期间 JS 不跑）、
 * **自动化测试驱动不了它**（Playwright/Cypress 要么卡住要么得挂原生对话框钩子）、
 * **无法本地化**（按钮文案由浏览器语言决定，站点 locale 管不到）、
 * **外观不受主题控制**（换主题、换暗色时它是唯一不跟着变的东西）。
 *
 * ## ★ 为什么本检查要自己去取 scope，而不是只用 `targets`
 *
 * `run-all.mjs` 用 `resolveScope()` 把 scope 解析成**文件条目**，而它会**跳过目录条目**
 * （`parse-index.mjs`：「目录条目不交给逐个文件的检查」）。本项目的后台是
 * `apps/admin/[X·AU·…]` 这样的**目录条目**，于是：
 *
 *   · scope 写 ⟨V|O⟩        → 只命中 apps/web/src/App.vue，后台一个 .vue 都进不来；
 *   · scope 写 ⟨X|V|O⟩×⟨AU⟩ → 命中 **0** 个目标，run-all 直接记为"无法判定"。
 *
 * 也就是说：**"scope 锚对了面"与"文件真的被扫到"是两件事**，中间的目录条目会被丢掉。
 * 若不补这一步，本约束会在后台"通过得毫无内容"——比没有约束更糟，因为它看起来检查过了。
 * 所以这里做两件事，缺一不可：
 *   ① scope 里必须含 `X`（`apps/admin/` 的坐标），否则连"适用"都算不上；
 *   ② 本检查按**自己那条 scope**（从 constraints.mjs 读，避免把 scope 抄第二遍而漂移）
 *      把命中的目录条目展开成其下的 .vue 文件。
 *
 * ## 诚实声明（已知漏检）
 *
 * 「原生模态」在本检查里等价于**字面量正则** `window.<name>(`，因此下列写法会漏：
 *   · `globalThis.alert(...)` / `self.confirm(...)` / `top.prompt(...)`
 *   · 解构后再调：`const { confirm } = window; confirm(...)`
 *   · 动态拼名：`window['con' + 'firm'](...)`
 * 反过来，**注释里提到这几个名字也会被报**（本检查不剥离注释）——
 * 这是有意选择：这类规则的误报极其罕见，而漏报会让约束形同虚设。
 * 判不了的时候（读不到文件）返回 2 而不是 0。
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { SKIP_DIRS } from '../lib/dictionary.mjs'
import { parseIndex } from '../lib/parse-index.mjs'
import { constraints } from '../constraints.mjs'

export const meta = {
  id: 'no-window-modal',
  contract: '0=通过 1=失败 2=无法判定',
}

/**
 * 原生模态调用。`\s*` 容忍 `window . confirm (`，仍不跨语句。
 * 不用 `\bconfirm\(` 这种裸名字：组件自己实现的 `confirm()` 方法（例如媒体选择器的
 * "确定"按钮）是合法的，把它报出来属于误报。
 */
const FORBIDDEN = /window\s*\.\s*(confirm|alert|prompt)\s*\(/g

/** 列出一个目录条目下的全部 .vue（与索引完整性用同一份 SKIP_DIRS，避免扫到 dist/）。 */
function collectVueFiles(root, dirPath) {
  const found = []
  const walk = (abs, rel) => {
    let items
    try {
      items = readdirSync(abs, { withFileTypes: true })
    } catch {
      return
    }
    for (const item of items) {
      if (item.name.startsWith('.')) continue
      if (SKIP_DIRS.has(item.name)) continue
      const childRel = rel === '' ? item.name : `${rel}/${item.name}`
      if (item.isDirectory()) {
        walk(join(abs, item.name), childRel)
        continue
      }
      if (item.name.endsWith('.vue')) found.push(childRel)
    }
  }
  walk(join(root, dirPath), dirPath.replace(/\/+$/, ''))
  return found.sort()
}

/** 条目是否落在约束 scope 的坐标内。 */
function inScope(entry, scope) {
  const layers = scope.layers ?? null
  const domains = scope.domains ?? null
  if (layers && !layers.includes(entry.layer)) return false
  if (domains && !domains.includes(entry.domain)) return false
  return true
}

export async function run({ root, targets, ctx }) {
  const declared = constraints.find((c) => c.id === meta.id)
  if (!declared) {
    return {
      status: 2,
      summary: '在 constraints.mjs 里找不到本约束的 scope，无法判定',
      details: [
        `${meta.id} 未在 strata/constraints.mjs 里注册（或 id 写错）。`,
        '本检查要按自己声明的 scope 展开目录条目，读不到 scope 就不能猜 —— 猜出来的范围不可信。',
      ],
    }
  }

  const scope = declared.scope ?? {}
  const entries = ctx?.entries ?? parseIndex(root).entries

  /* ① scope 命中的文件条目里，属于本约束的那部分 */
  const directFiles = new Set((targets ?? []).filter((path) => path.endsWith('.vue')))

  /* ② scope 命中的目录条目展开成文件 —— 这一步是 apps/admin/ 能进来的唯一途径 */
  const expandedFiles = new Set()
  const expanded = []
  for (const entry of entries.values()) {
    if (!entry.path.endsWith('/')) continue
    if (!inScope(entry, scope)) continue
    const found = collectVueFiles(root, entry.path)
    if (found.length === 0) continue
    for (const file of found) expandedFiles.add(file)
    expanded.push({ dir: entry.path, face: `${entry.layer}·${entry.domain}`, count: found.length })
  }

  const files = [...new Set([...directFiles, ...expandedFiles])].sort()
  const directOnly = [...directFiles].filter((file) => !expandedFiles.has(file))

  if (files.length === 0) {
    if ((targets ?? []).length === 0) {
      return {
        status: 2,
        summary: '没有适用文件 —— scope 没解析出任何目标',
        details: [
          `约束 scope 是 ⟨${(scope.layers ?? ['全部层']).join('|')}⟩ × ⟨${(scope.domains ?? ['全部域']).join('|')}⟩，`,
          '索引里没有任何条目落在它的坐标上，且展开不出 .vue —— 约束目前无处生效。',
          '这不是通过。检查 apps/admin/（目录条目，坐标 X·AU）是否被 scope 的 layers 覆盖。',
        ],
      }
    }
    return {
      status: 2,
      summary: '适用目标里没有 .vue 文件，无法判定',
      details: [
        `适用面命中 ${targets.length} 个文件条目，但没有 .vue 文件，目录条目也没展开出 .vue。`,
        '后台/前台的页面尚未落地，或页面不是 .vue —— 两种情况都要先确认，不能当作通过。',
      ],
    }
  }

  const violations = []
  let unreadable = 0

  for (const relative of files) {
    let source
    try {
      source = readFileSync(join(root, relative), 'utf8')
    } catch {
      unreadable += 1
      continue
    }

    for (const match of source.matchAll(FORBIDDEN)) {
      const line = source.slice(0, match.index).split('\n').length
      const lineText = source.split('\n')[line - 1] ?? ''
      violations.push({
        file: relative,
        line,
        call: match[0].replace(/\s+/g, ''),
        text: lineText.trim().slice(0, 110),
      })
    }
  }

  const scopeNote = [
    `适用面 ⟨${(scope.layers ?? ['全部层']).join('|')}⟩ × ⟨${(scope.domains ?? ['全部域']).join('|')}⟩；`,
    `文件条目 ${directOnly.length} 个${directOnly.length > 0 ? `（${directOnly.join('、')}）` : ''}；`,
    expanded.length > 0
      ? `目录条目展开 ${expanded.map((e) => `${e.dir}（${e.face}）× ${e.count}`).join('、')}。`
      : '没有目录条目命中（若后台是目录条目，说明 scope 的 layers 少了它的层码）。',
  ]

  if (violations.length > 0) {
    const details = [`no-window-modal: ${violations.length} 处原生模态`]
    for (const v of violations) {
      details.push(`  ${v.file}:${v.line}  ${v.call}  ——  ${v.text}`)
    }
    details.push('')
    details.push('修法：改用 Naive UI 的 `useDialog()`（`dialog.warning({...})`，')
    details.push('      `onPositiveClick` 返回 Promise 时对话框会保持 loading 到请求落定），')
    details.push('      或在模板里用 `<n-modal>` 自绘。两者都要求组件在 n-dialog-provider 的子树内。')
    details.push('')
    details.push(...scopeNote)
    return { status: 1, summary: `原生模态 ${violations.length} 处`, details }
  }

  if (unreadable > 0) {
    return {
      status: 2,
      summary: `${unreadable} 个文件读不了，判定不完整`,
      details: [`有 ${unreadable} 个 .vue 无法读取，未检出的部分不能算通过。`, ...scopeNote],
    }
  }

  const dirPart = expanded.map((e) => `${e.dir}（${e.face}）× ${e.count}`).join('、')
  return {
    status: 0,
    summary:
      `通过（检查 ${files.length} 个 .vue：` +
      `${dirPart ? `目录条目 ${dirPart}；` : ''}文件条目 ${directOnly.length} 个）`,
    details: [
      ...scopeNote,
      '（文本正则，有漏检：globalThis/self 上的同名方法、解构后再调、动态拼名字都看不见；',
      '  反过来注释里提到这几个名字会误报。）',
    ],
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await run({ root: process.cwd(), targets: process.argv.slice(2) })
  for (const line of result.details ?? []) console.error(line)
  console.log(`${meta.id}: ${result.summary}`)
  process.exit(result.status)
}
