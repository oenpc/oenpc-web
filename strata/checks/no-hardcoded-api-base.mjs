/**
 * 约束 id: runtime-config（面：层 E,X × 域 CO,ST）
 *
 * 契约：exit 0 = 通过 / 1 = 失败 / 2 = 无法判定
 *
 * 规则：**API 基址必须运行时可配**（`/config.json` 或 `window.__APP_CONFIG__` 注入），
 * 禁止在构建期把它写进产物。否则同一份构建产物无法在测试/生产复用。
 *
 * 检测的是**构建期注入**与**硬编码主机**两类。允许的形式：
 *   - 运行时读取：`window.__APP_CONFIG__`、`await fetch('/config.json')`
 *   - 同源相对路径：`'/api'`、`/events` 这类不含主机的基址
 *
 * 检测是文本启发式，有漏检与误检 —— 这一点必须写在输出里，
 * 因为**一个开始喊狼来了的约束会被绕过，然后彻底失效**。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const meta = {
  id: 'runtime-config',
  contract: '0=通过 1=失败 2=无法判定',
}

const RULES = [
  {
    id: 'build-time-env',
    pattern: /import\.meta\.env\.[A-Z0-9_]*(?:API|BASE|HOST|ORIGIN|SERVER)[A-Z0-9_]*/g,
    why: '构建期注入的 API 基址会被打进产物 —— 换环境必须重新构建。',
  },
  {
    id: 'build-time-env-any',
    pattern: /import\.meta\.env\.VITE_[A-Z0-9_]*(?:URL|ENDPOINT)[A-Z0-9_]*/g,
    why: 'URL / ENDPOINT 类环境变量通常是后端地址，同样会被打进产物。',
  },
  {
    id: 'hardcoded-host',
    pattern: /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?/g,
    why: '硬编码的本地主机地址会随构建进入产物，线上必然失效。',
  },
]

export async function run({ root, targets }) {
  if (!targets || targets.length === 0) {
    return {
      status: 2,
      summary: '没有适用文件（E/X 层尚未落地），无法判定',
      details: ['索引里没有落在 ⟨E|X⟩ × ⟨CO|ST⟩ 面上的条目 —— 约束无处生效。'],
    }
  }

  const violations = []
  let unreadable = 0

  for (const relative of targets) {
    let source
    try {
      source = readFileSync(join(root, relative), 'utf8')
    } catch {
      unreadable += 1 /* 读不了 ≠ 通过 */
      continue
    }

    const lines = source.split('\n')
    lines.forEach((line, index) => {
      const trimmed = line.trim()
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
      for (const rule of RULES) {
        rule.pattern.lastIndex = 0
        if (rule.pattern.test(line)) {
          violations.push({ file: relative, line: index + 1, rule: rule.id, why: rule.why, text: trimmed.slice(0, 100) })
        }
      }
    })
  }

  const details = []
  if (violations.length > 0) {
    details.push(`runtime-config: ${violations.length} 处违规`)
    for (const v of violations) {
      details.push(`  ${v.file}:${v.line}  [${v.rule}]  ${v.text}`)
      details.push(`      ${v.why}`)
    }
    details.push('')
    details.push('修法：基址改为运行时读取 ——')
    details.push('  · 入口处 await fetch(\'/config.json\') 或读 window.__APP_CONFIG__')
    details.push('  · 客户端只接受注入进来的基址，默认值用同源相对路径 \'/api\'')
    details.push('')
    details.push('注意：本检查是文本启发式，允许同源相对路径，不判断「配置是否真的可覆盖」。')
    return { status: 1, summary: `硬编码 API 基址 ${violations.length} 处`, details }
  }

  if (unreadable > 0) {
    details.push(`有 ${unreadable} 个文件无法读取，判定不完整。`)
    return { status: 2, summary: `${unreadable} 个文件读不了，判定不完整`, details }
  }

  details.push(`检查了 ${targets.length} 个文件，未发现构建期注入或硬编码主机。`)
  details.push('（文本启发式，有漏检 —— 它不能证明基址一定可覆盖。）')
  return { status: 0, summary: `通过（${targets.length} 个文件）`, details }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await run({ root: process.cwd(), targets: process.argv.slice(2) })
  for (const line of result.details ?? []) console.error(line)
  console.log(`${meta.id}: ${result.summary}`)
  process.exit(result.status)
}
