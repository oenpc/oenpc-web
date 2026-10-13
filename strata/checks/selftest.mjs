#!/usr/bin/env node
/**
 * 判决层契约自测 —— 断言 `strata:check` 的退出码映射 **0 / 1 / 2**。
 *
 * ## 为什么需要这个文件
 *
 * 在仓库当前状态下，有 9 条约束尚无检查形态、3 条面上还没有条目，
 * 所以聚合器**永远返回 2 或 1，退出码 0 是走不到的**。
 *
 * **一条从未被执行过的分支等于没写。** 契约（0=通过 / 1=失败 / 2=无法判定）
 * 是这个判决层对外最重要的承诺 —— 它必须被独立验证，而不是靠"应该没问题"。
 *
 * 所以 `decideExitCode` 被抽成纯函数，本文件直接喂给它各种结果组合。
 *
 * 运行：pnpm strata:selftest
 *
 * ## 顺带证明的一件事
 *
 * 本文件是**新增文件，却没有新增任何索引条目与约束**（它被
 * `strata/checks/` 这个**目录条目**自动覆盖）。这正是 STRATA 的核心主张：
 * **新文件继承规则，而不是产生新规则。**
 */

import { decideExitCode } from './run-all.mjs'

const cases = [
  {
    name: '全部通过 → 0',
    results: [{ outcome: 'pass' }, { outcome: 'pass' }],
    expect: 0,
  },
  {
    name: '有一条失败 → 1（失败优先于无法判定）',
    results: [{ outcome: 'pass' }, { outcome: 'unknown' }, { outcome: 'fail' }],
    expect: 1,
  },
  {
    name: '失败与无法判定并存 → 1',
    results: [{ outcome: 'fail' }, { outcome: 'unknown' }],
    expect: 1,
  },
  {
    name: '只有无法判定 → 2',
    results: [{ outcome: 'pass' }, { outcome: 'unknown' }],
    expect: 2,
  },
  {
    name: '没有任何约束 → 2（"没找到问题" ≠ "没检查"）',
    results: [],
    expect: 2,
  },
  {
    name: '全部无法判定 → 2',
    results: [{ outcome: 'unknown' }, { outcome: 'unknown' }],
    expect: 2,
  },
]

let failed = 0

console.log('')
console.log('STRATA 判决层契约自测')
console.log('')

for (const testCase of cases) {
  const actual = decideExitCode(testCase.results)
  const ok = actual === testCase.expect
  if (!ok) failed += 1
  const mark = ok ? 'PASS' : 'FAIL'
  const detail = ok ? '' : `  期望 ${testCase.expect}，实际 ${actual}`
  console.log(`  ${mark}  ${testCase.name}${detail}`)
}

console.log('')
console.log('  目录条目是否进入约束的检查范围：')
console.log('')

/*
 * ★ 锁住一个曾经真实存在的静默漏检。
 *
 * `resolveScope` 原先对有 `path.endsWith('/')` 的目录条目直接 `continue`，
 * 后果是：AGENTS.md 推荐的"一组同类文件用目录条目覆盖"会让这批文件
 * **从所有按坐标筛选的约束里消失**，而约束照常报 PASS（它一个文件都没检查）。
 *
 * 实证：`⟨V|O⟩` 的解析结果曾只有 1 个文件，修好后是 5 个 ——
 * 多出来的 4 个正是 `apps/web/src/pages/` 下长期没被检查过的页面。
 *
 * 这里断言**目录条目能被展开**，而不是断言具体数字：
 * 数字会随仓库变化，而"展开这件事本身成立"是契约。
 */
{
  /* 本文件在 strata/checks/ 下，上两级即仓库根 —— 不依赖调用者的 cwd */
  const { fileURLToPath } = await import('node:url')
  const { dirname, resolve } = await import('node:path')
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

  const { parseIndex, resolveScope } = await import('../lib/parse-index.mjs')
  const { entries } = parseIndex(ROOT)
  const dirEntry = [...entries.values()].find((e) => e.path.endsWith('/'))

  if (!dirEntry) {
    failed += 1
    console.log('  FAIL  索引里找不到目录条目 —— 这条自测无法生效（索引可能被改坏）')
  } else {
    /* 不带 root：无法展开；带 root：应当展开出至少一个文件 */
    const withoutRoot = resolveScope(entries, { layers: [dirEntry.layer] })
    const withRoot = resolveScope(entries, { layers: [dirEntry.layer] }, ROOT)
    const expanded = withRoot.filter((p) => p.startsWith(dirEntry.path))

    const ok = expanded.length > 0
    if (!ok) failed += 1
    console.log(
      `  ${ok ? 'PASS' : 'FAIL'}  目录条目 ${dirEntry.path} 展开出 ${expanded.length} 个文件` +
        (ok ? '' : '（为 0 说明 resolveScope 又在丢弃目录条目了）'),
    )
    console.log(
      `        （对照：不传 root 时解析出 ${withoutRoot.length} 个，传 root 时 ${withRoot.length} 个）`,
    )
  }
}

console.log('')

if (failed > 0) {
  console.error(`契约自测失败 ${failed} 项 —— 判决层的退出码语义已经不可信。`)
  console.error('在修好之前，不要相信 strata:check 的任何结论。')
  process.exit(1)
}

console.log(`  ${cases.length + 1} 项全部通过：退出码语义 0/1/2、「2 不等于通过」、目录条目可展开。`)
console.log('')
process.exit(0)
