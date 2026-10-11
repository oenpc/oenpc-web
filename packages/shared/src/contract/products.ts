/**
 * 产品契约（PD 域）。
 *
 * 这是全站最核心的数据外形：前台列表/详情、后台管理、导入导出、搜索
 * 都围绕它。改动它要同步检查 R / S / D / V / X 五层 —— 条目 `R:` 字段应体现这一点。
 *
 * ## 三个关键设计取舍
 *
 * 1. **文本字段一律 `LocalizedText`，不按语种加列。**
 *    理由见 `../locales.ts`：加第三语种时不能改表结构（硬约束 `multi-locale-schema`）。
 *
 * 2. **`slug` 也是多语的。**
 *    外贸站的 URL 要能被搜索引擎分语种收录：`/en/products/steel-pipe` 与
 *    `/zh/products/gangguan`。如果 slug 只有一份，两种语言就只能共用一个 URL，
 *    那就等于只有一种语言能被索引（硬约束 `every-public-page-has-url`）。
 *
 * 3. **时间字段是 ISO8601 UTC 字符串，不是 `Date`。**
 *    `Date` 经 JSON 序列化会变成带本地时区的字符串，跨机传递后时区信息丢失。
 *    存字符串、且必须是 UTC，转换只发生在展示层（硬约束 `utc-storage`）。
 */

import type { LocaleCode, LocalizedText } from '../locales.js'
import type { PurchaseChannelLink } from './channels.js'

/** 产品分类：多级树，`parentId` 为空表示顶层。 */
export interface ProductCategory {
  id: string
  slug: LocalizedText
  name: LocalizedText
  parentId: string | null
  sortOrder: number
  createdAt: string
  updatedAt: string
}

/**
 * 规格参数键值对。
 *
 * `key` 也是多语的 —— 「材质」与「Material」是同一个规格项，
 * 不该在后台出现两行。
 */
export interface ProductSpec {
  key: LocalizedText
  value: LocalizedText
}

/** 产品完整外形（后台编辑用）。 */
export interface Product {
  id: string
  slug: LocalizedText
  name: LocalizedText
  /** 列表页摘要。 */
  summary: LocalizedText
  /** 详情页正文。 */
  description: LocalizedText
  categoryId: string | null
  specs: ProductSpec[]
  /** 媒体库 id，顺序即前台展示顺序。 */
  mediaIds: string[]
  channels: PurchaseChannelLink[]
  /** 下架后前台 404、sitemap 移除，但**不删数据**（保留历史与询盘关联）。 */
  published: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

/**
 * 列表页精简外形。
 *
 * **故意不复用 `Product`**：列表页不需要 `description` 与 `specs`，
 * 而这两个字段往往是全表最大的两列。列表接口若返回完整对象，
 * 一个 24 条的分类页会多传几百 KB —— 外贸站首屏对这个尤其敏感。
 */
export interface ProductListItem {
  id: string
  slug: LocalizedText
  name: LocalizedText
  summary: LocalizedText
  categoryId: string | null
  /** 仅封面，不含全部图集。 */
  coverMediaId: string | null
  channels: PurchaseChannelLink[]
  sortOrder: number
}

/** 产品检索条件（功能清单 F2.4 产品搜索）。 */
export interface ProductQuery {
  /** 关键词，匹配产品名的多语字段。 */
  keyword?: string
  categoryId?: string
  publishedOnly?: boolean
  /** 列表接口必须显式传语种 —— 不允许仓储层静默回落到默认语种（陷阱 P-11）。 */
  locale: LocaleCode
  page?: number
  pageSize?: number
}
