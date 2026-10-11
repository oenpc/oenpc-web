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

if (failed > 0) {
  console.error(`契约自测失败 ${failed} 项 —— 判决层的退出码语义已经不可信。`)
  console.error('在修好之前，不要相信 strata:check 的任何结论。')
  process.exit(1)
}

console.log(`  ${cases.length} 项全部通过：退出码语义 0/1/2 与「2 不等于通过」成立。`)
console.log('')
process.exit(0)
