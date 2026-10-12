/**
 * URL 结构 与 `hreflang` 互指 —— **决策 2（URL 结构）的落地点**。
 *
 * ## 为什么这个文件值得单独存在
 *
 * URL 结构是**对外公开的契约**：一旦被搜索引擎收录，再改就是丢排名。
 * 把它收在一个模块里，而不是散落在各个页面的模板字符串里，
 * 是为了让"改 URL 结构"成为一次可审计的改动，而不是几十处字符串替换。
 *
 * ## 两个容易做错的地方
 *
 * ### 1. `hreflang` 的值**不等于** URL 前缀
 *
 * URL 用短码 `/zh/` 保持可读；但 `hreflang` 要符合 ISO 639-1（+ 可选 script/region）。
 * **简体与繁体中文是不同内容**，只写 `zh` 会让搜索引擎无法区分，
 * 正确写法是 `zh-Hans` / `zh-Hant`。所以这里有一张显式映射表。
 *
 * ### 2. 必须有 `x-default`
 *
 * 它是"没有匹配到任何语言时"的兜底入口（通常是默认语种）。
 * 漏掉它，语言定向不匹配的访客会落在搜索引擎随机选中的那个语种页面上。
 */

import { PUBLIC_DEFAULT_LOCALE, SUPPORTED_LOCALES, type LocaleCode } from '@oenpc-web/shared'

/**
 * 语种码 → `hreflang` 标签。**故意与 URL 前缀不同**，见文件头第 1 条。
 */
export const HREFLANG_TAGS: Record<LocaleCode, string> = {
  zh: 'zh-Hans',
  en: 'en',
  es: 'es',
}

/** 一个页面在**各语种**下的站内路径。某个语种缺失 = 该内容没有这个语种的版本。 */
export type LocalePaths = Partial<Record<LocaleCode, string>>

export function homePath(locale: LocaleCode): string {
  return `/${locale}/`
}

export function productListPath(locale: LocaleCode): string {
  return `/${locale}/products`
}

export function productDetailPath(locale: LocaleCode, slug: string): string {
  return `/${locale}/products/${encodeURIComponent(slug)}`
}

/** 站内路径 → 绝对 URL。`siteUrl` 末尾的斜杠先归一化，否则会出现 `//en/`。 */
export function absoluteUrl(siteUrl: string, path: string): string {
  const base = siteUrl.replace(/\/+$/, '')
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 生成 `<head>` 里的 SEO 片段：`canonical` + 全部 `alternate` + `x-default`。
 *
 * @param paths 该页面在各语种下的路径（由构建期枚举得到）
 * @param currentLocale 当前正在渲染的语种，用于 `canonical` 与 `<html lang>`
 */
export function seoHead(
  siteUrl: string,
  paths: LocalePaths,
  currentLocale: LocaleCode,
  title: string,
): string {
  const tags: string[] = [`<title>${escapeAttribute(title)}</title>`]

  const current = paths[currentLocale]
  if (current) {
    tags.push(`<link rel="canonical" href="${escapeAttribute(absoluteUrl(siteUrl, current))}" />`)
  }

  for (const locale of SUPPORTED_LOCALES) {
    const path = paths[locale]
    if (!path) continue
    const tag = HREFLANG_TAGS[locale]
    tags.push(
      `<link rel="alternate" hreflang="${tag}" href="${escapeAttribute(absoluteUrl(siteUrl, path))}" />`,
    )
  }

  /* x-default：语言定向不匹配时的兜底入口 */
  const fallback = paths[PUBLIC_DEFAULT_LOCALE]
  if (fallback) {
    tags.push(
      `<link rel="alternate" hreflang="x-default" href="${escapeAttribute(absoluteUrl(siteUrl, fallback))}" />`,
    )
  }

  return tags.join('\n    ')
}

/** `<html lang>` 用的值 —— 与 `hreflang` 同源，避免两处不一致。 */
export function htmlLang(locale: LocaleCode): string {
  return HREFLANG_TAGS[locale]
}
