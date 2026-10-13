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
 * ## ★ 目标从哪来：只用 `targets`，检查器不再自己读索引
 *
 * `run-all.mjs` 用 `resolveScope(entries, scope, root)` 把 scope 解析成**源码文件路径**，
 * 其中**目录条目已经展开**成其下的文件 —— 所以 `apps/admin/`（目录条目 `X·AU`）
 * 下的 .vue 会作为普通文件路径出现在 `targets` 里。
 *
 * 这里曾经有一份**自己的**展开逻辑（读回索引 → 按 scope 挑目录条目 → 递归收集 .vue），
 * 那是 `resolveScope` 还会丢弃目录条目时的绕行手段。它一旦留下就是**第二个真相来源**：
 * 判决层改了展开规则（例如新增 SOURCE_EXTS、改 SKIP_DIRS），检查器仍旧按旧规则扫，
 * 两边给出的"检查范围"会静默分叉 —— 而范围分叉的后果正是"PASS 但什么都没查"。
 * 所以现在只信 `targets`；范围不对要修的是 `resolveScope`，不是这里。
 *
 * 代价（**必须知道**）：本检查单独执行（`node strata/checks/no-window-modal.mjs`）
 * 拿不到 run-all 解析出的范围，只会得到"没有目标"的 2。要复现真实判定请走
 * `pnpm strata:check` 或把文件路径当参数传进来。
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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

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

export async function run({ root, targets }) {
  const all = (targets ?? []).filter((path) => path.endsWith('.vue')).sort()

  if (all.length === 0) {
    return {
      status: 2,
      summary: '适用目标里没有 .vue 文件，无法判定',
      details: [
        `适用面命中 ${(targets ?? []).length} 个路径，但没有一个是 .vue。`,
        '后台/前台的页面尚未落地，或页面不是 .vue —— 两种情况都要先确认，不能当作通过。',
        '若这里恒为 0 而仓库里明明有 .vue，那是判决层的范围解析坏了',
        '（目录条目没展开）：修 strata/lib/parse-index.mjs 的 resolveScope，',
        '而不是在本检查里再补一份展开逻辑 —— 两份真相会静默分叉。',
      ],
    }
  }

  const violations = []
  const unreadable = []

  for (const relative of all) {
    let source
    try {
      source = readFileSync(join(root, relative), 'utf8')
    } catch {
      unreadable.push(relative)
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
    `本检查只看 run-all 的 resolveScope 交过来的 ${all.length} 个 .vue`,
    '（目录条目在判决层已展开成文件）—— 检查器不再自己读索引，避免两份范围分叉。',
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

  if (unreadable.length > 0) {
    return {
      status: 2,
      summary: `${unreadable.length} 个文件读不了，判定不完整`,
      details: [
        `有 ${unreadable.length} 个 .vue 无法读取，未检出的部分不能算通过：`,
        ...unreadable.map((path) => `  - ${path}`),
        ...scopeNote,
      ],
    }
  }

  return {
    status: 0,
    summary: `通过（检查 ${all.length} 个 .vue：${all.join('、')}）`,
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
