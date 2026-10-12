#!/usr/bin/env node
/**
 * 构建期预渲染（SSG）—— **P0.3 spike 的核心**。
 *
 * ## 它要回答的四个问题
 *
 * 1. 多语 URL 前缀（`/<locale>/...`）与预渲染能否共存
 * 2. 动态路由（每个产品一个页面）如何在构建期枚举
 * 3. `hreflang` 互指能否**正确地**出现在静态 HTML 里
 * 4. 产物是否零运行时依赖（可直接丢给 A 机 nginx）
 *
 * ## 三件容易做错的事（都在下面显式处理了）
 *
 * ### 1. 必须**翻页**取产品
 *
 * 服务端 `MAX_PAGE_SIZE = 60`。只取第一页的话，产品超过 60 个时
 * **构建会成功，但站点静默少了页面** —— 而本地看目录结构一切正常，
 * 直到有人在搜索里找不到自己的产品。这是 SSG 特有的一类静默失败。
 *
 * ### 2. 每个产出页都断言**路由真的匹配上了**
 *
 * 若某个 URL 拼错，路由会落到 `not-found`，而预渲染**照样会写出一个 HTML**
 * —— 于是构建出一整站 404 页面，而且搜索引擎会把它们全部收录。
 * 所以这里断言 `routeName` 必须是预期值，不匹配就中止构建。
 *
 * ### 3. 某个语种没有该产品的翻译时，**不要**产出该语种页面
 *
 * 产出它就是造一个软 404（页面存在但没有这个语言的内容），
 * 而且会在 `hreflang` 里宣告一个虚假的翻译版本 —— 两者都会被搜索引擎降权。
 *
 * ## 数据来源
 *
 * 构建期从**运行中的 API** 拉数据（`OENPC_WEB_API_BASE`）。
 * 这意味着**构建依赖一个可用的后端** —— 这是本方案的固有代价，
 * 换来的是"构建产物与数据库一致"（不需要把数据访问逻辑复制进构建脚本）。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { PUBLIC_DEFAULT_LOCALE, SUPPORTED_LOCALES } from '@oenpc-web/shared'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = join(HERE, '..')
const CLIENT_DIR = join(WEB_ROOT, 'dist', 'client')
const SERVER_ENTRY = join(WEB_ROOT, 'dist', 'server', 'entry-server.js')

const SITE_URL = (process.env.OENPC_WEB_SITE_URL ?? 'http://127.0.0.1:3900').replace(/\/+$/, '')
const API_BASE = (process.env.OENPC_WEB_API_BASE ?? SITE_URL).replace(/\/+$/, '')
const PAGE_SIZE = 60
const MAX_PAGES = 200

const { renderPage, messagesFor, homePath, productListPath, productDetailPath } = await import(
  pathToFileURL(SERVER_ENTRY).href
)

/** 逐页取完**全部**已上架产品 —— 不能只取第一页，理由见文件头第 1 条。 */
async function fetchAllProducts(locale) {
  const all = []
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `${API_BASE}/api/products?locale=${locale}&page=${page}&pageSize=${PAGE_SIZE}`
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`拉取产品失败：${url} → HTTP ${response.status}`)
    }
    const body = await response.json()
    if (!body.ok) {
      throw new Error(`接口返回错误：${body.code}`)
    }
    all.push(...body.data.items)
    if (all.length >= body.data.total || body.data.items.length === 0) return all
  }
  /* 宁可中断构建，也不产出一个不完整的站点 —— 缺页是静默的，而报错是响亮的 */
  throw new Error(`分页超过 ${MAX_PAGES} 页仍未取完，疑似分页参数异常`)
}

const products = await fetchAllProducts(PUBLIC_DEFAULT_LOCALE)
const template = readFileSync(join(CLIENT_DIR, 'index.html'), 'utf8')

/**
 * 取单个产品的**完整**外形。
 *
 * ★ 列表接口返回的是 `ProductListItem`，它**故意**不含 `description` / `specs` /
 *   `mediaIds`（列表不需要，而它们往往是全表最大的两列）。
 *   拿列表项去渲染详情页会缺字段 —— 本轮 spike 就是这么撞上的。
 *   跨 JSON 边界 TS 类型不生效，所以下面还有一次运行时形状断言。
 */
async function fetchProduct(id) {
  const url = `${API_BASE}/api/products/${encodeURIComponent(id)}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`拉取产品详情失败：${url} → HTTP ${response.status}`)
  const body = await response.json()
  if (!body.ok) throw new Error(`产品详情接口返回错误：${body.code}`)
  return body.data
}

/**
 * 断言拿到的是**详情**形状而不是列表形状。
 *
 * 没有这道断言时，失败的形态是 SSR 渲染到一半抛 `Cannot read properties of undefined`，
 * 栈里全是 Vue 内部帧 —— 看得见但不好定位。有了它，报错直接说清缺哪个字段。
 */
function assertDetailShape(product, id) {
  for (const field of ['specs', 'channels', 'mediaIds']) {
    if (!Array.isArray(product[field])) {
      throw new Error(
        `产品 ${id} 缺少数组字段 "${field}" —— 详情页需要完整 Product，而不是列表项 ProductListItem`,
      )
    }
  }
}

const written = []
const problems = []

/**
 * 渲染一个页面并写到 `dist/client/<path>/index.html`。
 *
 * @param expectRoute 期望匹配到的路由名 —— 不匹配即判定为构建失败
 */
async function emit(path, locale, paths, payload, title, expectRoute) {
  const context = { ...payload, locale, paths, messages: messagesFor(locale) }
  const rendered = await renderPage(path, context, title)

  if (rendered.routeName !== expectRoute) {
    problems.push(`${path} 期望路由 "${expectRoute}"，实际匹配到 "${rendered.routeName}"`)
    return
  }

  /*
   * 注入水合数据。
   * `replace(/</g, '\\u003c')` 不是可选项：JSON 里若出现 `</script>`，
   * 浏览器会**提前结束**脚本标签，页面结构当场崩掉。这是 XSS 的经典入口之一。
   */
  const serialized = JSON.stringify({ ...payload, locale, paths }).replace(/</g, '\\u003c')

  const html = template
    .replace('<html>', `<html lang="${rendered.lang}">`)
    .replace('<!--seo-head-->', rendered.head)
    .replace('<!--app-html-->', rendered.html)
    .replace('</body>', `  <script>window.__APP_DATA__=${serialized}</script>\n  </body>`)

  const target = join(CLIENT_DIR, path.replace(/^\/+/, ''), 'index.html')
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, html)
  written.push(path)
}

/* ── 静态页：首页与产品列表，每个语种各一份 ── */

const homePaths = Object.fromEntries(SUPPORTED_LOCALES.map((locale) => [locale, homePath(locale)]))
const listPaths = Object.fromEntries(SUPPORTED_LOCALES.map((locale) => [locale, productListPath(locale)]))

for (const locale of SUPPORTED_LOCALES) {
  const { siteName, productsTitle } = messagesFor(locale)
  const base = { siteUrl: SITE_URL, product: null }

  await emit(homePath(locale), locale, homePaths, { ...base, products: [] }, siteName, 'home')
  await emit(productListPath(locale), locale, listPaths, { ...base, products }, productsTitle, 'product-list')
}

/* ── 动态页：每个产品在每个**有翻译**的语种下各一份 ── */

for (const item of products) {
  const paths = {}
  for (const locale of SUPPORTED_LOCALES) {
    const slug = item.slug[locale]
    if (slug) paths[locale] = productDetailPath(locale, slug)
  }
  if (Object.keys(paths).length === 0) continue

  const detail = await fetchProduct(item.id)
  assertDetailShape(detail, item.id)

  /*
   * `paths` 只包含**确实存在**的语种 —— 于是 hreflang 不会宣告虚假的翻译版本。
   * 代价是：某个产品只有英文时，它的中文页面不存在。这是诚实的，
   * 相反的做法（回落到英文内容却挂在 /zh/ 下）会造成重复内容。
   */
  for (const locale of Object.keys(paths)) {
    await emit(
      paths[locale],
      locale,
      paths,
      { siteUrl: SITE_URL, products: [], product: detail },
      detail.name[locale] ?? detail.id,
      'product-detail',
    )
  }
}

/* ── 根路径：跳转到默认语种 ── */
{
  const target = `${SITE_URL}${homePath(PUBLIC_DEFAULT_LOCALE)}`
  writeFileSync(
    join(CLIENT_DIR, 'index.html'),
    `<!doctype html>
<html lang="${PUBLIC_DEFAULT_LOCALE}">
  <head>
    <meta charset="utf-8" />
    <!-- 语言定向不匹配时的兜底入口；同时给出 x-default 让搜索引擎理解这是重定向页 -->
    <link rel="canonical" href="${target}" />
    <link rel="alternate" hreflang="x-default" href="${target}" />
    <meta http-equiv="refresh" content="0; url=${homePath(PUBLIC_DEFAULT_LOCALE)}" />
    <title>Redirecting</title>
  </head>
  <body>
    <a href="${homePath(PUBLIC_DEFAULT_LOCALE)}">${target}</a>
  </body>
</html>
`,
  )
}

/* ── sitemap 与 robots ── */

writeFileSync(
  join(CLIENT_DIR, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${written.map((path) => `  <url><loc>${SITE_URL}${path}</loc></url>`).join('\n')}
</urlset>
`,
)

writeFileSync(
  join(CLIENT_DIR, 'robots.txt'),
  `User-agent: *
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml
`,
)

/* ── 自检：把 HTML 读回来核对 SEO 片段（不信任"我们写对了"）── */

let checkedAlternates = 0
for (const path of written) {
  const file = join(CLIENT_DIR, path.replace(/^\/+/, ''), 'index.html')
  const content = readFileSync(file, 'utf8')

  if (!content.includes('rel="canonical"')) problems.push(`${path} 缺少 canonical`)
  if (!content.includes('hreflang="x-default"')) problems.push(`${path} 缺少 x-default`)
  /* 语言切换链接也应带 hreflang，所以用 rel="alternate" 计数更准确 */
  const alternates = (content.match(/rel="alternate"/g) ?? []).length
  if (alternates < 1) problems.push(`${path} 没有任何 alternate 链接`)
  if (!content.includes('window.__APP_DATA__')) problems.push(`${path} 缺少水合数据`)
  if (/\u4e00-\u9fff/.test(content.replace(/window\.__APP_DATA__=[^<]*/g, '')) && path.startsWith('/en/')) {
    /* 英文页里残留中文 = i18n 漏了（注意排除水合数据本身，它含全部语种） */
    problems.push(`${path} 英文页里出现未翻译的中文`)
  }
  checkedAlternates += alternates
}

/* ── 输出 ── */

console.log('')
console.log('预渲染完成')
console.log(`  站点地址   ${SITE_URL}`)
console.log(`  数据来源   ${API_BASE}`)
console.log(`  产品       ${products.length} 个（已上架）`)
console.log(`  产出页面   ${written.length} 个`)
console.log(`  语种       ${SUPPORTED_LOCALES.join(' / ')}`)
console.log(`  alternate 链接合计 ${checkedAlternates} 条`)
console.log('')
console.log('  产出示例：')
for (const path of written.slice(0, 8)) console.log(`    ${path}`)
if (written.length > 8) console.log(`    …另有 ${written.length - 8} 个`)

if (problems.length > 0) {
  console.error('')
  console.error(`预渲染自检失败 ${problems.length} 项：`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

console.log('')
console.log('  自检通过：canonical / x-default / alternate / 水合数据 均已就位')
