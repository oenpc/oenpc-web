#!/usr/bin/env node
/**
 * 从**索引条目**计算 STRATA 的自测指标 —— 权威 κ。
 *
 * 为什么不能用 `strata/measure.mjs` 代替它：
 * 那个工具默认用**目录结构**代理面，而「同一目录 ⇒ 同面」是构造上必然的，
 * 所以它给出的 κ **系统性偏高**，只是**上界**，不具区分力
 * （STRATA 实测：同一仓库在 depth=1..4 下 κ 恒在 0.94–0.99）。
 *
 * **有意义的 κ 必须用你自己的字典来算。** 索引条目就是字典的落地形态，
 * 所以本文件从条目算 —— 这才是可以拿来下结论的数。
 *
 * 用法：node strata/measure-index.mjs [--json <path>]
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { parseIndex, computeCoverage, computeKappa } from './lib/parse-index.mjs'

const args = process.argv.slice(2)
const opt = (flag, fallback = null) => {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : fallback
}
const ROOT = process.cwd()
const JSON_OUT = opt('--json')

const parsed = parseIndex(ROOT)
if (!parsed.ok) {
  console.error(`无法解析索引：${parsed.reason}`)
  process.exit(2)
}
if (parsed.problems.length > 0) {
  console.error(`索引有 ${parsed.problems.length} 处条目格式问题，指标不可信：`)
  for (const p of parsed.problems) console.error(`  docs/strata-index.md:${p.line}  ${p.reason}`)
  process.exit(2)
}

const total = parsed.entries.size
if (total === 0) {
  console.log('')
  console.log('STRATA measure（索引口径）')
  console.log('')
  console.log('  条目数 |F| = 0 —— 仓库里还没有索引条目。')
  console.log('  按 STRATA「字典先于条目」，这是骨架期的预期状态：')
  console.log('    §0 字典已定稿 → 骨架落地 → 立刻补 §2 条目（与骨架同一次提交）。')
  console.log('')
  console.log('  现在算出任何 κ 都没有意义 —— 它会是 0/0。')
  process.exit(2)
}

const coverage = computeCoverage(ROOT, [], parsed.entries)
const metrics = computeKappa(coverage.byFace, total)

const bar = (x, width = 24) => '█'.repeat(Math.round(x * width)).padEnd(width, '·')
const pct = (x) => `${(x * 100).toFixed(1)}%`

console.log('')
console.log('STRATA measure（索引口径 —— 权威值）')
console.log(`  root : ${ROOT}`)
console.log('')
console.log('── 规模 ──')
console.log(`  条目 |F|     ${total}`)
console.log(`  面   |faces| ${metrics.faces}   （上界 = |层| × |域| = 11 × 12 = 132）`)
console.log(`  面/条目      ${(metrics.faces / total).toFixed(3)}`)
console.log('')
console.log('── 共享面分布 ──')
console.log(`  共享面（≥2 条目）  ${String(metrics.sharedFaces).padStart(4)}  ${bar(metrics.sharedFaces / metrics.faces)}`)
console.log(`  单文件面           ${String(metrics.singletonFaces).padStart(4)}  ${bar(metrics.singletonFaces / metrics.faces)}`)
console.log('')
console.log('── 主指标：κ（共享面覆盖率）──')
console.log(`  κ = ${metrics.kappa.toFixed(3)}   ${bar(metrics.kappa)}  ${pct(metrics.kappa)}`)
console.log('')

/*
 * 退化守卫：条目只落在极少数面上时，κ 必然接近 1.0。
 * 那证明的是「字典还没被检验」，**不是**「面锚定有效」——
 * 它与目录代理给出的 0.94–0.99 是同一类假信号（STRATA 明确警告过的那一类）。
 * 所以这种情况下拒绝给出「适用」的结论。
 */
const degenerate = metrics.faces <= 2

const verdict = degenerate
  ? `不具区分力 —— 全部条目只落在 ${metrics.faces} 个面上，κ 是退化值`
  : metrics.kappa >= 0.5
    ? '适用 —— 面是有效的压缩，按 quickstart 落地'
    : metrics.kappa >= 0.3
      ? '部分适用 —— 只在密集区域有收益；报告结论时必须限定范围'
      : '不适用 —— 面已退化为文件；只保留判决层（quickstart §5），它不依赖 κ'
console.log(`  判定：${verdict}`)

if (degenerate) {
  console.log('')
  console.log(`  ⚠ 本次测量**不能**用来支持「面锚定有效」：${total} 条条目只落在 ${metrics.faces} 个面上。`)
  console.log('     单个面装下全部条目时，κ 必然接近 1.0 —— 它证明的是"字典还没被产品代码检验"，')
  console.log('     与目录代理给出 0.94–0.99 属于同一类假信号。')
  console.log('     骨架落地、产品代码带上各自的坐标之后，这个数才有意义。')
}

/*
 * STRATA reference.md §3.4 的实测修正：锚定收益**不均匀**。
 * 共享面上新增同类文件 MRC = 0（真实收益）；单文件面上面元退化为点元，MRC 与逐点制相同（零收益）。
 * 所以结论不能说成「整个仓库都零成本」，只能说「重区承担大部分文件」。
 */
console.log('')
console.log('  注意收益不均匀（reference.md §3.4）：')
console.log('    · 共享面上新增同类文件 → 边缘规则成本 0，这是真实收益')
console.log('    · 单文件面上 → 面退化为点，成本与逐点制相同，零收益')
console.log('  因此不要主张「整个仓库都零成本」，只能说重区（共享面）承担了大部分条目。')

console.log('')
console.log('── 面分布明细 ──')
const sorted = [...coverage.byFace].sort((a, b) => b[1].length - a[1].length)
for (const [face, list] of sorted) {
  const mark = list.length >= 2 ? '共享' : '单件'
  console.log(`  ${face.padEnd(8)} ${mark}  ${String(list.length).padStart(3)}  ${bar(list.length / sorted[0][1].length, 16)}`)
}

console.log('')
console.log('── γ 未计算 ──')
console.log('  γ（新增文件里"需要一个新面"的比例）需要 git 历史，用 strata/measure.mjs 计算：')
console.log('    pnpm strata:measure')
console.log('  γ 低 = 新文件大多落在已有面上 = 面锚定有收益。')

if (JSON_OUT) {
  mkdirSync(dirname(JSON_OUT), { recursive: true })
  writeFileSync(
    JSON_OUT,
    `${JSON.stringify(
      {
        root: ROOT,
        generatedAt: new Date().toISOString(),
        source: 'docs/strata-index.md §2',
        metrics: { entries: total, ...metrics },
        faces: sorted.map(([face, list]) => ({ face, count: list.length, entries: list })),
      },
      null,
      2,
    )}\n`,
  )
  console.log('')
  console.log(`已写出 JSON: ${JSON_OUT}`)
}

process.exit(0)
