#!/usr/bin/env node
/**
 * κ 测量的**诚实包装** —— 挡住上游 `measure.mjs` 会喊出的假信号。
 *
 * ## 要解决的问题（实测发现，不是假想）
 *
 * 上游 `measure.mjs` 用显式字典（`--layers` / `--domains`）时，
 * 按目录段匹配坐标；**匹配不上的目录段一律归为 `(unknown)`**：
 *
 *     const layer  = customLayers.find((l) => dirs.includes(l)) ?? '(unknown)'
 *     const domain = customDomains.find((d) => dirs.includes(d)) ?? '(unknown)'
 *
 * 于是当**字典与仓库结构完全不匹配**时（例如产品代码还没落地），
 * 所有文件挤进 `(unknown)·(unknown)` 与 `checks·(unknown)` 两个面 ——
 * 而这两个面**恰好都是"共享面"**，所以 κ 仍然是 1.0，
 * `measure.mjs` 会打印 **「判定：适用 —— 面是有效的压缩」**。
 *
 * **这比"目录代理偏高"更危险**：它看起来是权威配置（显式字典）给出的结论，
 * 实际是垃圾。一个假信号比没有信号更糟 —— 因为它让 Agent 和人**都以为检查过了**。
 *
 * ## 本包装做什么
 *
 * 跑同一套测量，但**先统计有多少文件落到了 `(unknown)`**：
 *   · 比例 > 50% → **拒绝出结论**，退出码 **2（无法判定）**
 *   · 比例 ≤ 50% → 正常报告，并附上上游的"上界"警告
 *
 * 注意它**不改** `measure.mjs` —— 那个文件是从 STRATA 上游复制的（MIT），
 * 要改测量逻辑应当去上游改再同步回来，否则两处漂移。
 *
 * 运行：pnpm strata:measure
 */

import { collectFiles, faceOf, computeMetrics } from './measure.mjs'

const args = process.argv.slice(2)
const opt = (flag, fallback = null) => {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : fallback
}
const has = (flag) => args.includes(flag)

const ROOT = opt('--root', process.cwd())
const DEPTH = Number(opt('--depth', '2'))
const customDictionary = Boolean(opt('--layers') || opt('--domains'))

const files = collectFiles(ROOT)
if (files.length === 0) {
  console.error(`${ROOT} 下没有找到源码文件，无法判定。`)
  process.exit(2)
}

const metrics = computeMetrics(files, DEPTH)

const unknownFiles = files.filter((file) => {
  const { layer, domain } = faceOf(file, DEPTH)
  return layer === '(unknown)' || domain === '(unknown)'
})

const bar = (x, width = 24) => '█'.repeat(Math.round(x * width)).padEnd(width, '·')
const pct = (x) => `${(x * 100).toFixed(1)}%`
const unknownShare = unknownFiles.length / files.length

console.log('')
console.log('STRATA measure（带诚实守卫的包装）')
console.log(`  root  : ${ROOT}`)
console.log(`  depth : ${DEPTH}  ${customDictionary ? '(显式字典)' : '(目录结构代理)'}`)
console.log('')
console.log('── 规模 ──')
console.log(`  文件 |F|     ${metrics.files}`)
console.log(`  面   |faces| ${metrics.faces}`)
console.log('')
console.log('── 主指标：κ（共享面覆盖率，目录口径）──')
console.log(`  κ = ${metrics.kappa.toFixed(3)}   ${bar(metrics.kappa)}  ${pct(metrics.kappa)}`)

/*
 * 守卫：字典与仓库结构不匹配时，`(unknown)` 面会伪装成"共享面"，
 * 让 κ 虚假地接近 1.0。这种情况必须拒绝出结论，而不是报"适用"。
 */
if (customDictionary && unknownShare > 0.5) {
  console.log('')
  console.log('── 守卫触发：拒绝出结论 ──')
  console.log(`  ${unknownFiles.length}/${files.length} 个文件（${pct(unknownShare)}）的坐标落到 (unknown)`);
  console.log('  —— 说明**这份字典与当前仓库结构不匹配**。')
  console.log('')
  console.log('  此时 `(unknown)` 面会被当成"共享面"，让 κ 虚假地接近 1.0。')
  console.log('  **不要**把这个数当成"面锚定有效"的证据，也不要相信任何「适用」判定。')
  console.log('')
  console.log('  这类文件的坐标（前 8 个）：')
  for (const file of unknownFiles.slice(0, 8)) {
    const { layer, domain } = faceOf(file, DEPTH)
    console.log(`    ${file}  →  ${layer}·${domain}`)
  }
  console.log('')
  console.log('  字典的权威口径在 docs/strata-index.md §0；要测权威 κ 请用：')
  console.log('    pnpm strata:measure:index')
  process.exit(2)
}

console.log('')
const verdict =
  metrics.kappa >= 0.5
    ? '适用 —— 面是有效的压缩，按 quickstart 落地'
    : metrics.kappa >= 0.3
      ? '部分适用 —— 只在密集区域有收益；报告结论时必须限定范围'
      : '不适用 —— 面已退化为文件；只保留判决层（quickstart §5），它不依赖 κ'
console.log(`  判定：${verdict}`)

/*
 * 上游自己声明的局限，必须原样带出来（照抄 STRATA 的诚实要求）：
 * 用目录结构代理面时，"同一目录 ⇒ 同面"是构造上必然的，所以 κ 系统性偏高、只是**上界**。
 */
if (!customDictionary) {
  console.log('')
  console.log('  ⚠ 上界警告：本数值用「目录结构」代理面，会系统性偏高。')
  console.log('     同目录 ⇒ 同面 是构造上必然的，所以它是**上界**，不是估计值。')
  console.log('     要得到有意义的 κ，请用 --layers/--domains 传入你自己的字典，')
  console.log('     或直接用 pnpm strata:measure:index 从索引条目计算权威值。')
}

const topDirs = new Map()
for (const file of files) {
  const parts = file.split('/')
  const key = parts.length > 1 ? parts[0] : '(root)'
  topDirs.set(key, (topDirs.get(key) ?? 0) + 1)
}
const sortedDirs = [...topDirs].sort((a, b) => b[1] - a[1]).slice(0, 8)
console.log('')
console.log('── 顶层目录规模（字典的候选切分点）──')
for (const [dir, count] of sortedDirs) {
  console.log(`  ${String(count).padStart(5)}  ${dir}  ${bar(count / sortedDirs[0][1])}`)
}

console.log('')
console.log('── γ ──')
console.log('  γ 需要 git 历史与**多次提交**，请用上游工具：')
console.log('    node strata/measure.mjs --root . --layers <层目录名> --domains <域目录名>')
console.log('  注意：--layers/--domains 传的是**目录名**，不是层/域码。')
console.log('  单次初始提交算出的 γ 度量的是"第一次提交"，不是方法本身 —— 见索引 §6.2。')

console.log('')
process.exit(0)
