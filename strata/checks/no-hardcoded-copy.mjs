/**
 * 约束 id: no-hardcoded-copy（面：层 V,O × 全部域）
 *
 * 契约：exit 0 = 通过 / 1 = 失败 / 2 = 无法判定
 *
 * 规则：**界面文案不得硬编码在组件/模板里**，一律走 locale 资源（N 层）。
 * 多语言站点只要有单语残留，运营者就会在英文站上看到中文。
 *
 * ## 诚实声明（很重要）
 *
 * 本检查是**文本启发式**，它有两个已知缺陷：
 *   - **会漏检**：文案经由变量、插槽、指令传入时看不见。
 *   - **会误检**：注释、代码示例、品牌名（不应翻译）也会被算作文案。
 *
 * 因此它的输出应被当作**候选清单**而不是判决。按 STRATA 的说法：
 * **一个开始喊狼来了的约束会被绕过，然后彻底失效** ——
 * 所以本检查只报「模板区里的中日韩文字」，并且**判不了的时候返回 2 而不是 0**。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const meta = {
  id: 'no-hardcoded-copy',
  contract: '0=通过 1=失败 2=无法判定',
}

/** 中日韩统一表意文字（含扩展 A）与全角标点。 */
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3000-\u303f\uff01-\uff60]/

/** 这些文件本身就是文案资源，不在本约束的适用范围内。 */
const EXEMPT = /(?:^|\/)(?:locales?|i18n)\//i

/** 静态属性值里的文案（`placeholder="请输入"`），排除 `:placeholder="变量"`。 */
const STATIC_ATTR = /(^|\s)(?!:)(?:placeholder|title|label|alt|aria-label|content)\s*=\s*"([^"]*)"/g

function templateBlock(source) {
  const start = source.indexOf('<template>')
  if (start < 0) return null
  const end = source.indexOf('</template>', start)
  if (end < 0) return null
  const block = source.slice(start, end)
  const lineOffset = source.slice(0, start).split('\n').length - 1
  return { block, lineOffset }
}

export async function run({ root, targets }) {
  if (!targets || targets.length === 0) {
    return {
      status: 2,
      summary: '没有适用文件（V/O 层尚未落地），无法判定',
      details: ['索引里没有落在 ⟨V|O⟩ 面上的条目 —— 约束无处生效。'],
    }
  }

  const applicable = targets.filter((p) => p.endsWith('.vue') && !EXEMPT.test(p))
  if (applicable.length === 0) {
    return {
      status: 2,
      summary: '适用目标里没有 .vue 文件，无法判定',
      details: [
        `适用面命中 ${targets.length} 个目标，但没有 .vue 文件。`,
        '前端页面/组件尚未落地，或此项目的 UI 不是 .vue —— 两种情况都需要先确认，不能当作通过。',
      ],
    }
  }

  const candidates = []
  const allowed = []
  let unreadable = 0

  for (const relative of applicable) {
    let source
    try {
      source = readFileSync(join(root, relative), 'utf8')
    } catch {
      unreadable += 1
      continue
    }

    const extracted = templateBlock(source)
    if (!extracted) continue
    const { block, lineOffset } = extracted
    const lines = block.split('\n')

    lines.forEach((raw, index) => {
      const lineNumber = lineOffset + index + 1

      /*
       * 豁免：本行或上一行出现 `strata-allow-copy`。
       * 必须有这条逃生口 —— 品牌名、代码示例、不该翻译的专有名词一定存在。
       * 一个「开始喊狼来了」的约束会被绕过，然后彻底失效（STRATA 的明确警告）。
       * 但豁免要**被记录**：静默豁免会变成垃圾场。
       */
      const escaped =
        raw.includes('strata-allow-copy') ||
        (index > 0 && lines[index - 1].includes('strata-allow-copy'))
      if (escaped) {
        if (CJK.test(raw.replace(/<[^>]*>/g, ''))) {
          allowed.push({ file: relative, line: lineNumber, text: raw.trim().slice(0, 90) })
        }
        return
      }

      const line = raw.replace(/<!--[\s\S]*?-->/g, '')

      for (const match of line.matchAll(STATIC_ATTR)) {
        if (CJK.test(match[2])) {
          candidates.push({
            file: relative, line: lineNumber, kind: 'static-attr',
            text: match[0].trim().slice(0, 100),
          })
        }
      }

      /* 文本节点：去掉标签后看剩下的可见文字。 */
      const textOnly = line.replace(/<[^>]*>/g, '')
      if (CJK.test(textOnly)) {
        candidates.push({
          file: relative, line: lineNumber, kind: 'text-node',
          text: textOnly.trim().slice(0, 100),
        })
      }
    })
  }

  const details = []

  /* 豁免必须**可见** —— 静默豁免会变成垃圾场。 */
  const allowedNote = allowed.length > 0
    ? [
      '',
      `已豁免 ${allowed.length} 处（所在行或上一行含 strata-allow-copy）：`,
      ...allowed.map((a) => `  ${a.file}:${a.line}  ${a.text}`),
      '  豁免是合规的，但**理由要写进该文件的条目 S 字段** —— 否则下一个人不知道能不能删。',
    ]
    : []

  if (candidates.length > 0) {
    details.push(`no-hardcoded-copy: ${candidates.length} 处疑似硬编码文案`)
    for (const c of candidates) {
      details.push(`  ${c.file}:${c.line}  [${c.kind}]  ${c.text}`)
    }
    details.push('')
    details.push("修法：把文案移到 apps/*/src/locales/<语种>/<域>.json，模板里改用 t('<域>.<键>')。")
    details.push('')
    details.push('⚠ 这是启发式候选清单：品牌名、代码示例、注释都可能被误报。')
    details.push('  若某处确实不应翻译，在该行加 `<!-- strata-allow-copy -->`，并把理由写进条目 S 字段。')
    details.push(...allowedNote)
    return { status: 1, summary: `疑似硬编码文案 ${candidates.length} 处`, details }
  }

  if (unreadable > 0) {
    details.push(`有 ${unreadable} 个文件无法读取，判定不完整。`)
    return { status: 2, summary: `${unreadable} 个文件读不了，判定不完整`, details }
  }

  details.push(`检查了 ${applicable.length} 个 .vue 文件的模板区，未发现中日韩文字。`)
  details.push('（文本启发式，有漏检：文案经变量或插槽传入时看不见。）')
  details.push(...allowedNote)
  return {
    status: 0,
    summary: `通过（${applicable.length} 个文件${allowed.length > 0 ? `，豁免 ${allowed.length} 处` : ''}）`,
    details,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await run({ root: process.cwd(), targets: process.argv.slice(2) })
  for (const line of result.details ?? []) console.error(line)
  console.log(`${meta.id}: ${result.summary}`)
  process.exit(result.status)
}
