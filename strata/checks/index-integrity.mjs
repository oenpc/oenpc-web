/**
 * 约束 id: index-integrity（repoWide，不按面筛目标）
 *
 * 契约：exit 0 = 通过 / 1 = 失败 / 2 = 无法判定
 *
 * 检查三件事：
 *   ① 字典同步 —— `docs/strata-index.md` §0 与 `strata/lib/dictionary.mjs` 是否一致
 *   ② 索引完整性 —— 每个源码文件是否被条目覆盖（自身条目或所属目录条目）
 *   ③ 索引新鲜度 —— 是否有条目指向已不存在的路径
 *
 * 为什么必须做这件事：**索引过期比没有索引更危险** —— 它看起来权威。
 * 把「记得更新」从人的记性变成机械检查，是 STRATA §8 的维护要求。
 *
 * 粒度规则来自 STRATA `reference.md` §4.4：条目**不是**每个文件一条，
 * 一个文件可以被一个**目录条目**（路径以 `/` 结尾）覆盖。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { LAYERS, DOMAINS, FEATURES, INDEX_PATH } from '../lib/dictionary.mjs'
import { parseIndex, collectSourceFiles, computeCoverage } from '../lib/parse-index.mjs'

export const meta = {
  id: 'index-integrity',
  contract: '0=通过 1=失败 2=无法判定',
}

/** 字典同步：§0 里应当存在 `| \`CODE\` |` 形式的表格行。 */
function dictionaryDrift(root) {
  let markdown
  try {
    markdown = readFileSync(join(root, INDEX_PATH), 'utf8')
  } catch {
    return [`读不到索引文件 ${INDEX_PATH}`]
  }

  const hasRow = (code) => new RegExp(`^\\|\\s*\`${code}\`\\s*\\|`, 'm').test(markdown)
  const drift = []

  for (const [code, name] of LAYERS) {
    if (!hasRow(code)) drift.push(`层 ${code}（${name}）在 ${INDEX_PATH} §0.2 里没有表格行`)
  }
  for (const [code, name] of DOMAINS) {
    if (!hasRow(code)) drift.push(`域 ${code}（${name}）在 ${INDEX_PATH} §0.3 里没有表格行`)
  }
  for (const code of FEATURES) {
    if (!hasRow(code)) drift.push(`特征 ${code} 在 ${INDEX_PATH} §0.5 里没有表格行`)
  }
  return drift
}

export async function run({ root }) {
  const details = []

  /* ① 字典同步 —— 这一项与有没有源码无关，任何时候都可判定。 */
  const drift = dictionaryDrift(root)
  if (drift.length > 0) {
    details.push('字典漂移：`docs/strata-index.md` §0 与 `strata/lib/dictionary.mjs` 不一致。')
    details.push('权威是 §0 —— 先改文档，再改机读副本。')
    for (const item of drift) details.push(`  - ${item}`)
    return { status: 1, summary: `字典漂移 ${drift.length} 处`, details }
  }

  /* ② 索引可解析 */
  const parsed = parseIndex(root)
  if (!parsed.ok) {
    details.push(parsed.reason)
    return { status: 1, summary: '索引无法解析', details }
  }
  if (parsed.problems.length > 0) {
    details.push(`条目格式问题 ${parsed.problems.length} 处（判决层解析不到 = 该文件的约束不会生效）：`)
    for (const p of parsed.problems) {
      details.push(`  ${INDEX_PATH}:${p.line}  ${p.reason}`)
      details.push(`      ${p.text}`)
    }
    return { status: 1, summary: `条目格式问题 ${parsed.problems.length} 处`, details }
  }

  /* ③ 覆盖率与新鲜度 */
  const files = collectSourceFiles(root)
  const coverage = computeCoverage(root, files, parsed.entries)

  if (coverage.stale.length > 0) {
    details.push(`条目指向已不存在的路径 ${coverage.stale.length} 处（索引已过期）：`)
    for (const path of coverage.stale) details.push(`  - ${path}`)
    return { status: 1, summary: `过期条目 ${coverage.stale.length} 处`, details }
  }

  /*
   * 仓库里还没有源码 —— 这不是「通过」，而是「没有可判定的对象」。
   * STRATA 明确要求：「没找到问题」和「没检查」是两件事。
   */
  if (files.length === 0) {
    details.push('仓库里还没有源码文件，条目区为空。')
    details.push('这不是通过 —— 索引完整性目前没有任何可判定的对象。')
    details.push('按 STRATA「字典先于条目」，这是骨架期的预期状态：')
    details.push('  先定稿 §0 字典，骨架落地后立刻补 §2 条目，并与骨架放在同一次提交里。')
    return { status: 2, summary: '尚无源码文件，索引完整性无法判定', details }
  }

  if (coverage.uncovered.length > 0) {
    details.push(`有 ${coverage.uncovered.length} 个源码文件没有条目覆盖：`)
    for (const path of coverage.uncovered.slice(0, 40)) details.push(`  - ${path}`)
    if (coverage.uncovered.length > 40) {
      details.push(`  …另有 ${coverage.uncovered.length - 40} 个`)
    }
    details.push('')
    details.push('修法：在 §2 给每个文件补一条条目；若整组文件共享同一约束，')
    details.push('      用**目录条目**（路径以 / 结尾）覆盖它们 —— 那正是面锚定在索引侧的形态。')
    return { status: 1, summary: `未覆盖文件 ${coverage.uncovered.length} 个`, details }
  }

  details.push(`索引覆盖 ${files.length} 个源码文件，条目 ${parsed.entries.size} 条，无过期条目。`)
  return { status: 0, summary: `索引完整（${parsed.entries.size} 条 / ${files.length} 文件）`, details }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await run({ root: process.cwd() })
  for (const line of result.details ?? []) console.error(line)
  console.log(`${meta.id}: ${result.summary}`)
  process.exit(result.status)
}
