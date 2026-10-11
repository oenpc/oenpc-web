/**
 * 产品应用服务（PD 域）—— 编排仓储、施加策略。
 *
 * ## `S` 层与 `C` 层的分工
 *
 * `C`（core）是无框架依赖的**领域规则**；`S`（services）是**应用编排**：
 * 读配置、调仓储、施加访问策略、把多个仓储结果拼成一个用例。
 * 判断标准：需要碰 IO 或配置的编排 → `S`；纯计算与规则 → `C`。
 *
 * ## 公开与后台走**不同**的入口
 *
 * `listPublicProducts` 强制 `publishedOnly = true`，而后台列表不带这个约束。
 * 这不是重复代码 —— 它是**访问策略的水位线**：
 * 若让公开接口复用一个可由调用方传 `publishedOnly` 的函数，
 * 那么某天有人在前端加了 `?publishedOnly=false`，未上架的产品就露出去了。
 * 策略由服务端决定，不由入参决定。
 *
 * ## 语种：显式校验，不静默回落
 *
 * 请求语种非法 → `BAD_REQUEST`，而不是"悄悄用默认语种"。
 * 静默回落的症状是"前台显示了另一种语言"，而排查会一路查到缓存层 ——
 * 真正的错因（URL 里语种拼错）反而看不见（陷阱 P-11）。
 */

import type { DatabaseSync } from 'node:sqlite'
import type { LocaleCode, Page, Product, ProductListItem, ProductQuery } from '@oenpc-web/shared'
import { isSupportedLocale, PUBLIC_DEFAULT_LOCALE } from '@oenpc-web/shared'
import { AppError } from '../../core/errors.js'
import { getProductById, listProducts, listPublishedSlugs } from '../../repositories/products/repository.js'

/** 校验并归一化语种入参。非法值**报错**，不回落。 */
export function requireLocale(raw: string | undefined): LocaleCode {
  if (raw === undefined || raw === '') return PUBLIC_DEFAULT_LOCALE
  if (!isSupportedLocale(raw)) {
    throw new AppError('BAD_REQUEST', { field: 'locale', value: raw })
  }
  return raw
}

export interface PublicProductQuery {
  locale: string | undefined
  categoryId?: string | undefined
  keyword?: string | undefined
  page?: number | undefined
  pageSize?: number | undefined
}

/**
 * 公开站点：产品列表 / 搜索。
 *
 * 无论入参如何，`publishedOnly` 恒为 true —— 见文件头的说明。
 */
export function listPublicProducts(
  db: DatabaseSync,
  input: PublicProductQuery,
): Page<ProductListItem> {
  const query: ProductQuery = {
    locale: requireLocale(input.locale),
    publishedOnly: true,
    ...(input.categoryId ? { categoryId: input.categoryId } : {}),
    ...(input.keyword ? { keyword: input.keyword } : {}),
    ...(input.page !== undefined ? { page: input.page } : {}),
    ...(input.pageSize !== undefined ? { pageSize: input.pageSize } : {}),
  }
  return listProducts(db, query)
}

/**
 * 公开站点：产品详情。
 *
 * 未上架的产品对公开站点返回 **404 而不是 403** ——
 * 403 等于确认"这个 id 存在但你看不到"，把未发布的产品清单泄漏了出去。
 */
export function getPublicProduct(db: DatabaseSync, id: string): Product {
  const product = getProductById(db, id)
  if (!product || !product.published) throw new AppError('NOT_FOUND', { resource: 'product' })
  return product
}

/**
 * 构建期用：某语种下全部已上架产品的 slug。
 *
 * 前台是 SSG，构建期需要枚举出所有产品的 URL；同时 hreflang 互指需要
 * **每个语种**的 slug —— 所以调用方要对每个受支持语种各调一次。
 */
export function listProductSlugs(db: DatabaseSync, locale: LocaleCode): Array<{ id: string; slug: string }> {
  return listPublishedSlugs(db, locale)
}
