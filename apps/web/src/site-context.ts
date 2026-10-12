/**
 * 站点上下文 —— 用 `provide` 注入，**不用模块级可变状态**。
 *
 * ## 为什么不用模块级 store
 *
 * SSR 渲染时，多个页面在同一个 Node 进程里顺序渲染。
 * 模块级可变状态会在渲染之间**泄漏**：上一个页面的产品列表可能串到下一个页面里。
 * 这个 bug 的表现是"某些页面偶尔出现别的产品的名字"，极难复现与定位。
 *
 * `provide` / `inject` 的生命周期与 app 实例绑定，天然没有这个问题 ——
 * 每次渲染都新建一个 app，上下文互不影响。
 *
 * ## 客户端水合时数据从哪来
 *
 * 构建期把同一份上下文序列化进 HTML（`window.__APP_DATA__`），
 * 客户端读它并重建。这样首屏**不需要再发一次请求**，也不会出现内容闪变。
 * 服务端与客户端读的是**同一个结构**，避免"两份数据形状不一致"的经典水合失败。
 */

import { inject, type InjectionKey } from 'vue'
import type { LocaleCode, Product, ProductListItem } from '@oenpc-web/shared'
import type { Messages } from './i18n/messages'
import type { LocalePaths } from './seo/urls'

/** 构建期注入、客户端水合读取的数据（不含 `messages` —— 它由 `locale` 派生）。 */
export interface SitePayload {
  siteUrl: string
  locale: LocaleCode
  /** 当前页面在各语种下的路径，供语言切换与 hreflang 使用。 */
  paths: LocalePaths
  products: ProductListItem[]
  product: Product | null
}

export interface SiteContext extends SitePayload {
  messages: Messages
}

export const SITE_CONTEXT: InjectionKey<SiteContext> = Symbol('oenpc-web:site-context')

export function useSite(): SiteContext {
  const context = inject(SITE_CONTEXT)
  if (!context) {
    throw new Error('SITE_CONTEXT 未提供：组件必须在 createApp() 的 provide 之下渲染')
  }
  return context
}
