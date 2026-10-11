/**
 * 索引解析与源码清点 —— 判决层的公共库。
 *
 * STRATA 的坐标（面）**以索引条目为权威**，不从目录结构推断。
 * 目录结构只是给人看的约定（索引 §0.7），用于让 measure.mjs 的代理值有参考意义。
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  LAYERS, DOMAINS, IMPORTANCE, SCALES, FEATURES,
  ENTRY_RE, MALFORMED_RE, INDEX_PATH, SOURCE_EXTS, SOURCE_ROOTS, SKIP_DIRS,
} from './dictionary.mjs'

/**
 * 取出索引里 `## 2.` 到 `## 3.` 之间的正文。
 *
 * 为什么只在这一段里找条目：§0.1 会**举例**一条格式正确的条目，
 * 全文扫描会把那个例子当成真条目收进来，污染索引。
 * 用小节边界而不是"跳过代码围栏"，因为真实条目本来就写在代码围栏里。
 */
export function entrySection(markdown) {
  const lines = markdown.split('\n')
  let start = -1
  let end = lines.length
  for (let i = 0; i < lines.length; i += 1) {
    if (start < 0 && /^##\s*2\./.test(lines[i])) {
      start = i
      continue
    }
    if (start >= 0 && /^##\s*3\./.test(lines[i])) {
      end = i
      break
    }
  }
  if (start < 0) return null
  return { lines, start, end }
}

/**
 * 解析索引 → 条目表。
 *
 * @returns {{ok: boolean, reason?: string, entries: Map<string, object>, problems: object[]}}
 */
export function parseIndex(root) {
  const file = join(root, INDEX_PATH)
  let markdown
  try {
    markdown = readFileSync(file, 'utf8')
  } catch {
    return { ok: false, reason: `读不到索引：${INDEX_PATH}`, entries: new Map(), problems: [] }
  }

  const section = entrySection(markdown)
  if (!section) {
    return { ok: false, reason: `索引里找不到 \`## 2.\` 小节（条目区）`, entries: new Map(), problems: [] }
  }

  const entries = new Map()
  const problems = []

  for (let i = section.start + 1; i < section.end; i += 1) {
    const line = section.lines[i]
    const match = ENTRY_RE.exec(line)
    if (match) {
      const [, path, layer, domain, importance, featureText, scale] = match
      const features = featureText ? featureText.split(',').filter(Boolean) : []
      const faults = []
      if (!LAYERS.has(layer)) faults.push(`层码 ${layer} 不在字典 §0.2`)
      if (!DOMAINS.has(domain)) faults.push(`域码 ${domain} 不在字典 §0.3`)
      if (!IMPORTANCE.has(Number(importance))) faults.push(`重要性 ${importance} 不在 {9,8,7,5,3,1}`)
      if (!SCALES.has(scale)) faults.push(`规模 ${scale} 不在 {XL,L,M,S}`)
      for (const feature of features) {
        if (!FEATURES.has(feature)) faults.push(`特征 ${feature} 不在封闭标记表 §0.5`)
      }

      if (faults.length > 0) {
        problems.push({ line: i + 1, text: line.trim().slice(0, 140), reason: faults.join('；') })
        continue
      }

      if (entries.has(path)) {
        problems.push({ line: i + 1, text: line.trim().slice(0, 140), reason: `重复条目：${path}` })
        continue
      }

      entries.set(path, {
        path, layer, domain, importance: Number(importance), features, scale, line: i + 1,
        raw: line.trim(),
      })
      continue
    }

    const malformed = MALFORMED_RE.exec(line)
    if (malformed) {
      problems.push({
        line: i + 1,
        text: line.trim().slice(0, 140),
        reason: '坐标格式不合法 —— 见索引 §0.1 的固定宽度格式',
      })
    }
  }

  return { ok: true, entries, problems }
}

/** 清点仓库里的源码文件（用于「索引完整性」）。 */
export function collectSourceFiles(root) {
  const found = []
  const walk = (dir) => {
    let items
    try {
      items = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const item of items) {
      if (item.name.startsWith('.')) continue
      if (SKIP_DIRS.has(item.name)) continue
      const full = join(dir, item.name)
      if (item.isDirectory()) {
        walk(full)
        continue
      }
      const dot = item.name.lastIndexOf('.')
      if (dot < 0) continue
      if (!SOURCE_EXTS.includes(item.name.slice(dot).toLowerCase())) continue
      found.push(relative(root, full).replace(/\\/g, '/'))
    }
  }
  for (const area of SOURCE_ROOTS) walk(join(root, area))
  return found.sort()
}

/**
 * 计算索引覆盖率。
 *
 * 粒度规则来自 STRATA `reference.md` §4.4：条目**不是**每个文件一条。
 * 所以一个源码文件被覆盖，可以是
 *   ① 它自己有条目，或
 *   ② 它落在某个**目录条目**（路径以 `/` 结尾）之下。
 */
export function computeCoverage(root, files, entries) {
  const dirEntries = [...entries.keys()].filter((p) => p.endsWith('/'))
  const uncovered = files.filter(
    (f) => !entries.has(f) && !dirEntries.some((d) => f.startsWith(d)),
  )

  /* 索引过期比没有索引更危险（它看起来权威）—— 指向不存在路径的条目一律报出来。 */
  const stale = []
  for (const path of entries.keys()) {
    const target = join(root, path)
    if (!existsSync(target)) stale.push(path)
    else if (path.endsWith('/') && !statSync(target).isDirectory()) stale.push(path)
  }

  /* §0.3 里给了"建议目录名" —— 用它算面的分布，供 κ 使用。 */
  const byFace = new Map()
  for (const entry of entries.values()) {
    const key = `${entry.layer}·${entry.domain}`
    if (!byFace.has(key)) byFace.set(key, [])
    byFace.get(key).push(entry.path)
  }

  return { uncovered, stale, byFace, dirEntries }
}

/** 从条目表算 κ（共享面覆盖率）。面 = ⟨层, 域⟩。 */
export function computeKappa(byFace, total) {
  const shared = [...byFace].filter(([, list]) => list.length >= 2)
  const covered = shared.reduce((sum, [, list]) => sum + list.length, 0)
  return {
    faces: byFace.size,
    sharedFaces: shared.length,
    singletonFaces: byFace.size - shared.length,
    kappa: covered / Math.max(1, total),
  }
}

/** 把 scope（层/域坐标）解析成索引里的目标文件。 */
export function resolveScope(entries, scope = {}) {
  const layers = scope.layers ?? null
  const domains = scope.domains ?? null
  const targets = []
  for (const entry of entries.values()) {
    if (layers && !layers.includes(entry.layer)) continue
    if (domains && !domains.includes(entry.domain)) continue
    if (entry.path.endsWith('/')) continue // 目录条目不交给逐个文件的检查
    targets.push(entry.path)
  }
  return targets
}
