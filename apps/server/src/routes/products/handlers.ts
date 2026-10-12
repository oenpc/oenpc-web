/**
 * 产品路由处理函数（PD 域，`R` 层）。
 *
 * ## `R` 层只做三件事
 *
 * 1. 解析与校验**入参格式**（是不是整数、有没有超长）
 * 2. 调服务层
 * 3. 套响应信封
 *
 * 它**不放业务规则**（那是 `S` / `C` 层的），也**不允许出现 SQL**
 * （约束 `no-sql-in-routes`）。
 *
 * ## 入参非法就报 400，不要静默纠正
 *
 * `?page=abc` 若被静默当成第 1 页，调用方会以为分页生效了 ——
 * 而它拿到的是第一页数据，与"服务端忽略了参数"无从区分。
 * 显式报错让问题停在调用方那一侧。
 */

import type { FastifyRequest } from 'fastify'
import type { ApiResponse, Page, Product, ProductListItem } from '@oenpc-web/shared'
import { AppError } from '../../core/errors.js'
import type { ProductRepository } from '../../repositories/products/port.js'
import { getPublicProduct, listPublicProducts } from '../../services/products/service.js'

export interface ProductRouteDeps {
  products: ProductRepository
}

export interface ProductListQuerystring {
  locale?: string
  categoryId?: string
  keyword?: string
  page?: string
  pageSize?: string
}

export interface ProductDetailParams {
  id: string
}

/**
 * querystring 里的数字是**字符串**，必须显式转换并校验。
 * 非整数、零、负数一律 400 —— 不做 `Math.max(1, ...)` 这类静默纠正。
 */
function parsePositiveInt(raw: string | undefined, field: string): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) {
    throw new AppError('BAD_REQUEST', { field, value: raw })
  }
  return value
}

export interface ProductHandlers {
  list: (
    request: FastifyRequest<{ Querystring: ProductListQuerystring }>,
  ) => Promise<ApiResponse<Page<ProductListItem>>>
  detail: (
    request: FastifyRequest<{ Params: ProductDetailParams }>,
  ) => Promise<ApiResponse<Product>>
}

export function createProductHandlers(deps: ProductRouteDeps): ProductHandlers {
  return {
    async list(request) {
      const { locale, categoryId, keyword, page, pageSize } = request.query

      const result = listPublicProducts(deps.products, {
        locale,
        categoryId,
        keyword,
        page: parsePositiveInt(page, 'page'),
        pageSize: parsePositiveInt(pageSize, 'pageSize'),
      })

      return { ok: true, data: result }
    },

    async detail(request) {
      /*
       * 不存在或未上架 → 服务层抛 NOT_FOUND，
       * 由 app.ts 的错误处理器统一转成信封（并记录日志）。
       * 这里不做 try/catch —— 那会让每个处理函数都重复一遍错误映射。
       */
      return { ok: true, data: getPublicProduct(deps.products, request.params.id) }
    },
  }
}
