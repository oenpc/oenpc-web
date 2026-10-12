/**
 * SSR 入口 —— 构建期由 `scripts/prerender.mjs` 调用，**不进入客户端产物**。
 *
 * 它同时负责产出 `<head>` 里的 SEO 片段。把这段逻辑放在 SSR 侧（而不是让
 * 预渲染脚本自己拼），是为了让 `hreflang` / `canonical` / `<html lang>`
 * 三者**永远同源** —— 它们分头计算时，最常见的 bug 是 hreflang 写 `zh-Hans`
 * 而 `<html lang>` 还写着 `zh`。
 */

import { createMemoryHistory } from 'vue-router'
import { renderToString } from '@vue/server-renderer'
import { createApp } from './app'
import { htmlLang, seoHead } from './seo/urls'
import type { SiteContext } from './site-context'

/*
 * 给构建脚本复用，**不要在两处各写一份**：
 *   · URL 结构（`seo/urls.ts`）—— 决策 2 的唯一来源
 *   · 文案（`i18n/messages.ts`）—— 页面标题的唯一来源
 * 预渲染脚本若自己拼这两个，就会出现"HTML 里是 A、脚本以为是 B"的漂移，
 * 而漂移的症状是标题与 canonical 指向不同的语种，很难第一眼看出。
 */
export { messagesFor } from './i18n/messages'
export { homePath, productListPath, productDetailPath } from './seo/urls'

export interface RenderedPage {
  html: string
  /** 注入到 `<!--seo-head-->` 的 SEO 片段。 */
  head: string
  /** 注入到 `<html lang="...">`。 */
  lang: string
  /**
   * 实际匹配到的路由名。
   *
   * 预渲染脚本会断言它**不是** `not-found` —— 否则一个 URL 拼写错误会让
   * 构建"成功"地产出一整站 404 页面，而且搜索引擎会把它们全收录。
   * 这是预渲染特有的一类静默失败：本地看目录结构一切正常。
   */
  routeName: string | null
}

export async function renderPage(
  url: string,
  context: SiteContext,
  title: string,
): Promise<RenderedPage> {
  const { app, router } = createApp(createMemoryHistory(), context)

  await router.push(url)
  await router.isReady()

  const html = await renderToString(app)
  const matched = router.currentRoute.value.name

  return {
    html,
    head: seoHead(context.siteUrl, context.paths, context.locale, title),
    lang: htmlLang(context.locale),
    routeName: typeof matched === 'string' ? matched : null,
  }
}
