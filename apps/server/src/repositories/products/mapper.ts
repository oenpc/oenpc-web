/**
 * 行 → DTO 的映射（PD 域）。
 *
 * ## 为什么单独成文件，而不是塞进仓储实现
 *
 * 仓储负责"怎么查"，映射负责"查出来的行怎么变成契约对象"。
 * 两者的改动原因不同，混在一起会让"改一个字段名"同时动到 SQL —— 那是 bug 的温床。
 *
 * ## 这一层要吸收三处**数据库与契约之间的阻抗失配**
 *
 * ### 1. 布尔值：SQLite 存 INTEGER 0/1，契约里是 `boolean`
 *
 * PG 有真正的 `boolean` 类型。若不做转换，前端会拿到 `0` / `1` ——
 * 而 `0` 是 falsy、`"0"` 是 truthy，"已下架却没被隐藏"这类 bug 就是这么来的。
 * 转换收口在这里。
 *
 * ### 2. 多语文本：库里是**多行翻译**，契约里是 `LocalizedText` 对象
 *
 * 显式收集，**不做静默回落**。缺失语种由 S 层按显式回退链决定 ——
 * 若这里悄悄回落，漏传语种就会表现为"前台显示了另一种语言"而不是报错（陷阱 P-11）。
 *
 * ### 3. JSON 列：库里是 TEXT，契约里是结构化值
 *
 * 解析失败返回 fallback 而不是抛错（见 `db/dialect.ts` 的说明）。
 */

import type {
  LocaleCode,
  LocalizedText,
  Product,
  ProductListItem,
  PurchaseChannelLink,
} from '@oenpc-web/shared'
import { isPurchasePlatform } from '@oenpc-web/shared'
import { fromJsonColumn } from '../../db/dialect.js'

/** `product` 表的一行。 */
export interface ProductRow {
  id: string
  category_id: string | null
  cover_media_id: string | null
  published: number
  sort_order: number
  created_at: string
  updated_at: string
}

/** `product_translation` 表的一行。 */
export interface ProductTranslationRow {
  product_id: string
  locale: string
  slug: string
  name: string
  summary: string
  description: string
}

export interface ProductSpecRow {
  product_id: string
  position: number
  key_json: string
  value_json: string
}

export interface PurchaseChannelRow {
  id: string
  product_id: string
  platform: string
  url: string
  label_json: string | null
  sort_order: number
}

/** SQLite 的 INTEGER 0/1 → 契约的 boolean。 */
function toBoolean(value: number | bigint | null): boolean {
  return value === 1 || value === 1n
}

/**
 * 把某产品的多行翻译收成一个 `LocalizedText`。
 *
 * 同一产品同一语种最多一行（翻译表主键是 `(product_id, locale)`），
 * 所以这里不需要处理重复。
 */
function collectLocalized(
  translations: readonly ProductTranslationRow[],
  pick: (row: ProductTranslationRow) => string,
): LocalizedText {
  const result: LocalizedText = {}
  for (const row of translations) {
    const value = pick(row)
    if (value !== '') result[row.locale as LocaleCode] = value
  }
  return result
}

/** 渠道行 → 契约链接。未知平台被**丢弃**而不是原样透传。 */
function toChannelLinks(rows: readonly PurchaseChannelRow[]): PurchaseChannelLink[] {
  const links: PurchaseChannelLink[] = []
  for (const row of rows) {
    /*
     * `platform` 存的是枚举码。若库里出现了枚举外的值（历史数据、手工改库），
     * 原样透传会让前端的平台图标查不到、渲染出一个空按钮。
     * 丢弃 + 记日志比渲染坏掉的按钮好；这里选择丢弃，日志由仓储层记录。
     */
    if (!isPurchasePlatform(row.platform)) continue
    links.push({
      id: row.id,
      platform: row.platform,
      url: row.url,
      sortOrder: row.sort_order,
      ...(row.label_json ? { label: fromJsonColumn<LocalizedText>(row.label_json, {}) } : {}),
    })
  }
  return links.sort((a, b) => a.sortOrder - b.sortOrder)
}

export function toProductListItem(
  row: ProductRow,
  translations: readonly ProductTranslationRow[],
  channels: readonly PurchaseChannelRow[],
): ProductListItem {
  return {
    id: row.id,
    slug: collectLocalized(translations, (t) => t.slug),
    name: collectLocalized(translations, (t) => t.name),
    summary: collectLocalized(translations, (t) => t.summary),
    categoryId: row.category_id,
    coverMediaId: row.cover_media_id,
    channels: toChannelLinks(channels),
    sortOrder: row.sort_order,
  }
}

export function toProduct(
  row: ProductRow,
  translations: readonly ProductTranslationRow[],
  specs: readonly ProductSpecRow[],
  mediaIds: readonly string[],
  channels: readonly PurchaseChannelRow[],
): Product {
  return {
    id: row.id,
    slug: collectLocalized(translations, (t) => t.slug),
    name: collectLocalized(translations, (t) => t.name),
    summary: collectLocalized(translations, (t) => t.summary),
    description: collectLocalized(translations, (t) => t.description),
    categoryId: row.category_id,
    specs: [...specs]
      .sort((a, b) => a.position - b.position)
      .map((spec) => ({
        key: fromJsonColumn<LocalizedText>(spec.key_json, {}),
        value: fromJsonColumn<LocalizedText>(spec.value_json, {}),
      })),
    mediaIds: [...mediaIds],
    channels: toChannelLinks(channels),
    published: toBoolean(row.published),
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
