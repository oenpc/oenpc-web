#!/usr/bin/env node
/**
 * STRATA 判决层聚合入口 —— `pnpm strata:check`
 *
 * ## 契约（三条）
 *
 * | 退出码 | 含义 |
 * |---|---|
 * | **0** | 通过 —— 全部可判定的约束都通过 |
 * | **1** | 失败 —— 附上约束 id、文件、行号、修法 |
 * | **2** | **无法判定** —— 诚实优于假装通过 |
 *
 * **为什么必须有 2**：很多规则不可判定。强迫给出 pass/fail 只会产出**假信号**，
 * 而假信号比没有信号更糟 —— 它让 Agent 和人**都以为检查过了**。
 *
 * 本聚合器把「没有可判定的对象」也归为 2：
 * **「没找到问题」和「没检查」是两件事。**
 *
 * ## 它按什么决定检查哪些文件
 *
 * 不是文件列表，而是**面**：读 `docs/strata-index.md` §2 得到 路径 → ⟨层,域⟩，
 * 再用每条约束的 `scope` 去筛。所以**新增文件只要落在已有面上，
 * 就自动被已有约束覆盖，不需要写任何新规则** —— 这就是锚定的收益。
 */

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { constraints } from '../constraints.mjs'
import { parseIndex, resolveScope } from '../lib/parse-index.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = process.cwd()

const c = {
  dim: (s) => `\u001b[2m${s}\u001b[0m`,
  red: (s) => `\u001b[31m${s}\u001b[0m`,
  green: (s) => `\u001b[32m${s}\u001b[0m`,
  yellow: (s) => `\u001b[33m${s}\u001b[0m`,
  bold: (s) => `\u001b[1m${s}\u001b[0m`,
}
const useColor = process.stdout.isTTY
const paint = (fn, s) => (useColor ? fn(s) : s)

/**
 * 退出码判定 —— 契约的唯一实现处（被 `strata/checks/selftest.mjs` 直接断言）。
 *
 * 抽成纯函数是**为了让 0 这条路径可测**：在当前仓库状态下，
 * 有 9 条约束尚无检查形态，聚合器永远返回 2 或 1，**退出码 0 是走不到的**。
 * 一条从未被执行过的分支等于没写 —— 所以把它拿出来单独验证。
 *
 * @param {{outcome: 'pass'|'fail'|'unknown'}[]} results
 * @returns {0|1|2}
 */
export function decideExitCode(results) {
  if (results.some((r) => r.outcome === 'fail')) return 1
  if (results.some((r) => r.outcome === 'unknown')) return 2
  /* 一条约束都没有 = 没有可判定的对象。**「没找到问题」和「没检查」是两件事** —— 归 2。 */
  if (results.length === 0) return 2
  return 0
}

async function loadCheck(relative) {
  const url = pathToFileURL(join(HERE, '..', relative)).href
  return import(url)
}

async function main() {
  const parsed = parseIndex(ROOT)
  const entries = parsed.ok ? parsed.entries : new Map()

  console.log('')
  console.log(paint(c.bold, 'STRATA 判决层  strata:check'))
  console.log(paint(c.dim, `  root  : ${ROOT}`))
  console.log(paint(c.dim, `  契约  : 0=通过  1=失败  2=无法判定（2 不等于通过）`))

  if (!parsed.ok) {
    console.log('')
    console.log(paint(c.red, `  索引不可用：${parsed.reason}`))
    console.log(paint(c.dim, '  按面筛选的约束都无法解析目标，将记为「无法判定」。'))
  } else if (parsed.problems.length > 0) {
    console.log('')
    console.log(paint(c.red, `  索引有 ${parsed.problems.length} 处条目格式问题（见 index-integrity 的详细输出）`))
  }

  console.log('')
  console.log(paint(c.dim, `  索引条目 ${entries.size} 条`))

  const results = []

  for (const constraint of constraints) {
    let outcome = 'pass'
    let summary = ''
    let details = []

    if (!constraint.check) {
      outcome = 'unknown'
      summary = '尚无检查形态 —— 只能靠人读'
      details = [
        `约束 ${constraint.id} 目前没有可执行形态。`,
        constraint.manual ? `原因：${constraint.manual}` : '',
        '按 STRATA 的实验假设，写不出检查形态的约束大概率不会生效 —— 它在 §4 的「检查形态」列里是空的。',
      ].filter(Boolean)
    } else {
      const targets = constraint.repoWide ? [] : resolveScope(entries, constraint.scope)

      if (!constraint.repoWide && targets.length === 0) {
        outcome = 'unknown'
        summary = '没有适用文件 —— 面上还没有条目'
        details = [
          `约束 ${constraint.id} 的 scope 是 ${describeScope(constraint.scope)}，但索引里没有对应的条目。`,
          '这不是通过：约束目前无处生效。骨架落地后补上条目，它会自动覆盖新文件。',
        ]
      } else {
        try {
          const module = await loadCheck(constraint.check)
          const result = await module.run({ root: ROOT, targets, ctx: { entries } })
          details = result.details ?? []
          summary = result.summary ?? ''
          outcome = result.status === 1 ? 'fail' : result.status === 2 ? 'unknown' : 'pass'
        } catch (error) {
          outcome = 'unknown'
          summary = `检查器自身出错：${String(error.message).slice(0, 120)}`
          details = [
            `无法运行 ${constraint.check}。`,
            '检查器崩溃是「无法判定」，不是「通过」—— 不假装知道。',
          ]
        }
      }
    }

    results.push({ constraint, outcome, summary, details })
  }

  /* ── 明细 ── */
  for (const { constraint, outcome, summary, details } of results) {
    const badge =
      outcome === 'pass' ? paint(c.green, 'PASS')
        : outcome === 'fail' ? paint(c.red, 'FAIL')
          : paint(c.yellow, 'UNKNOWN')

    console.log('')
    console.log(`  ${badge}  ${paint(c.bold, constraint.id)}  ${paint(c.dim, `[${describeScope(constraint.scope)}]`)}`)
    console.log(`         ${summary}`)
    if (outcome !== 'pass') {
      for (const line of details) console.log(`         ${line}`)
    }
  }

  /* ── 汇总 ── */
  const failed = results.filter((r) => r.outcome === 'fail')
  const unknown = results.filter((r) => r.outcome === 'unknown')
  const passed = results.filter((r) => r.outcome === 'pass')
  const code = decideExitCode(results)

  console.log('')
  console.log(paint(c.bold, '── 汇总 ──'))
  console.log(`  约束总数 ${results.length}   通过 ${passed.length}   失败 ${failed.length}   无法判定 ${unknown.length}`)
  console.log('')

  if (code === 1) {
    console.log(paint(c.red, `  退出码 1：${failed.length} 条约束失败`))
    console.log(paint(c.dim, '  失败的约束列在上面，每条都给了文件:行号与修法。'))
  } else if (code === 2) {
    console.log(paint(c.yellow, `  退出码 2：${unknown.length} 条约束无法判定`))
    console.log(paint(c.dim, '  2 不等于通过 —— 请如实报告哪条规则判不了、为什么（见 strata/constraints.mjs）。'))
  } else {
    console.log(paint(c.green, '  退出码 0：全部通过'))
  }

  return code
}

function describeScope(scope = {}) {
  const layers = scope.layers ? scope.layers.join('|') : '全部层'
  const domains = scope.domains ? scope.domains.join('|') : '全部域'
  return `⟨${layers}⟩ × ⟨${domains}⟩`
}

/*
 * 只在**被直接执行**时跑主流程。
 * 本文件同时是可 import 的库（导出 decideExitCode），
 * 若无条件执行，`strata/checks/selftest.mjs` 一 import 就会跑完整检查并 process.exit —— 对调用方是意外副作用。
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`判决层自身失败：${error.message}`)
      console.error('这是「无法判定」，不是「通过」。')
      process.exit(2)
    })
}
