/**
 * 约束 id: no-sql-in-routes（面：层 R,C × 全部域）
 *
 * 契约：exit 0 = 通过 / 1 = 失败 / 2 = 无法判定
 *
 * 规则：**SQL 只允许出现在 `repositories/` 与 `db/`（D 层）里。**
 * 路由（R）与领域核心（C）不得直接拼 SQL。
 *
 * 为什么这条重要：它是「预留 PostgreSQL 对接」**唯一可验证的形态**。
 * 若 SQL 散落在路由里，换 PG 时要改遍所有路由 —— 那时「预留」就成了一句空话。
 *
 * 相关约束 `portable-sql`（SQLite 专有语法集中在方言适配层）目前无检查形态，
 * 见 `strata/constraints.mjs`；它可以作为本检查的扩展落地。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const meta = {
  id: 'no-sql-in-routes',
  contract: '0=通过 1=失败 2=无法判定',
}

const RULES = [
  {
    id: 'sql-statement',
    pattern: /\b(?:SELECT\s+[\s\S]{0,240}?\s+FROM|INSERT\s+INTO|UPDATE\s+[\w."`]+\s+SET|DELETE\s+FROM|CREATE\s+(?:TABLE|INDEX|VIEW)|ALTER\s+TABLE|DROP\s+(?:TABLE|INDEX|VIEW))\b/i,
    why: '声明的 SQL 语句出现在 R/C 层 —— 数据访问必须收在仓储实现里。',
  },
  {
    id: 'direct-db-handle',
    pattern: /\b(?:db|database|conn|connection)\s*\.\s*(?:prepare|exec|execute|run|all|get|each)\s*\(/,
    why: '直接调用数据库句柄 —— 即使语句是变量拼接，也说明绕过了仓储层。',
  },
]

/** 去掉行内注释，避免把注释里举例的 SQL 当成违规。 */
function stripLineComment(line) {
  const trimmed = line.trim()
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return ''
  return line
}

export async function run({ root, targets }) {
  if (!targets || targets.length === 0) {
    return {
      status: 2,
      summary: '没有适用文件（R/C 层尚未落地），无法判定',
      details: ['索引里没有落在 ⟨R|C⟩ 面上的条目 —— 约束无处生效。'],
    }
  }

  const violations = []
  let unreadable = 0

  for (const relative of targets) {
    let source
    try {
      source = readFileSync(join(root, relative), 'utf8')
    } catch {
      unreadable += 1
      continue
    }

    source.split('\n').forEach((raw, index) => {
      const line = stripLineComment(raw)
      if (!line) return
      for (const rule of RULES) {
        if (rule.pattern.test(line)) {
          violations.push({
            file: relative,
            line: index + 1,
            rule: rule.id,
            why: rule.why,
            text: line.trim().slice(0, 110),
          })
        }
      }
    })
  }

  const details = []
  if (violations.length > 0) {
    details.push(`no-sql-in-routes: ${violations.length} 处违规`)
    for (const v of violations) {
      details.push(`  ${v.file}:${v.line}  [${v.rule}]  ${v.text}`)
      details.push(`      ${v.why}`)
    }
    details.push('')
    details.push('修法：把这句 SQL 移到 apps/server/src/repositories/<域>/ 下的仓储实现里，')
    details.push('      R/C 层改为调用仓储导出的函数。仓储是唯一允许出现 SQL 的地方。')
    return { status: 1, summary: `R/C 层出现 SQL ${violations.length} 处`, details }
  }

  if (unreadable > 0) {
    details.push(`有 ${unreadable} 个文件无法读取，判定不完整。`)
    return { status: 2, summary: `${unreadable} 个文件读不了，判定不完整`, details }
  }

  details.push(`检查了 ${targets.length} 个文件，R/C 层未发现 SQL。`)
  return { status: 0, summary: `通过（${targets.length} 个文件）`, details }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await run({ root: process.cwd(), targets: process.argv.slice(2) })
  for (const line of result.details ?? []) console.error(line)
  console.log(`${meta.id}: ${result.summary}`)
  process.exit(result.status)
}
