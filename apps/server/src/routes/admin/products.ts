/**
 * 后台产品路由（PD 域，`R` 层）。
 *
 * ## 权限点分开，不共用一个"管理员"开关
 *
 * `product:read` / `product:write` / `product:publish` 是三个独立的权限点。
 * 合并成一个的话，"能让实习生改文案但不能上架"这种真实需求就无法表达，
 * 只能靠口头约定 —— 而口头约定在有人离职后就不存在了。
 *
 * ## 路由泛型写在方法上（`app.get<{...}>()`），不是写在 handler 参数上
 *
 * 写在参数上（`async (request: FastifyRequest<{...}>) => {}`）时 TS 无法从
 * 参数反推路由类型，会报"RouteGenericInterface 不可赋值给 { Params: ... }"。
 * 泛型写在方法上，Fastify 才能把 `request.params` / `request.body` 推成具体类型。
 */

import type { FastifyInstance } from 'fastify'
import type { AdminProductSummary, ApiResponse, Page, Product, ProductInput } from '@oenpc-web/shared'
import { actorOf, requireAdmin } from '../../core/auth-context.js'
import { AppError } from '../../core/errors.js'
import type { ProductRepository } from '../../repositories/products/port.js'
import type { AuthService } from '../../services/auth/service.js'
import type { ProductAdminService } from '../../services/products/admin.js'

export interface AdminProductRouteDeps {
  auth: AuthService
  admin: ProductAdminService
  products: ProductRepository
}

function parsePositiveInt(raw: string | undefined, field: string, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) throw new AppError('BAD_REQUEST', { field, value: raw })
  return value
}

export function registerAdminProductRoutes(app: FastifyInstance, deps: AdminProductRouteDeps): void {
  app.get<{ Querystring: { page?: string; pageSize?: string } }>(
    '/api/admin/products',
    { preHandler: requireAdmin(deps.auth, 'product:read') },
    async (request): Promise<ApiResponse<Page<AdminProductSummary>>> => {
      const page = parsePositiveInt(request.query.page, 'page', 1)
      const pageSize = parsePositiveInt(request.query.pageSize, 'pageSize', 20)
      return { ok: true, data: deps.admin.list(page, pageSize) }
    },
  )

  /*
   * 新建与编辑都接收**整份** `ProductInput`（见契约里的说明）。
   * 不要在这里做字段级合并 —— 那正是 undefined/null 歧义的来源。
   */
  app.post<{ Body: ProductInput }>(
    '/api/admin/products',
    { preHandler: requireAdmin(deps.auth, 'product:write') },
    async (request): Promise<ApiResponse<Product>> => {
      if (!request.body) throw new AppError('BAD_REQUEST', { reason: 'empty_body' })
      return { ok: true, data: deps.admin.create(request.body, actorOf(request)) }
    },
  )

  app.get<{ Params: { id: string } }>(
    '/api/admin/products/:id',
    { preHandler: requireAdmin(deps.auth, 'product:read') },
    async (request): Promise<ApiResponse<Product>> => {
      const product = deps.products.getById(request.params.id)
      /* 后台返回 404 是安全的：调用方已通过鉴权，不存在枚举风险 */
      if (!product) throw new AppError('NOT_FOUND', { resource: 'product' })
      return { ok: true, data: product }
    },
  )

  app.put<{ Params: { id: string }; Body: ProductInput }>(
    '/api/admin/products/:id',
    { preHandler: requireAdmin(deps.auth, 'product:write') },
    async (request): Promise<ApiResponse<Product>> => {
      if (!request.body) throw new AppError('BAD_REQUEST', { reason: 'empty_body' })
      return { ok: true, data: deps.admin.update(request.params.id, request.body, actorOf(request)) }
    },
  )

  app.post<{ Params: { id: string }; Body: { published?: boolean } }>(
    '/api/admin/products/:id/published',
    { preHandler: requireAdmin(deps.auth, 'product:publish') },
    async (request): Promise<ApiResponse<{ id: string; published: boolean }>> => {
      const published = request.body?.published
      if (typeof published !== 'boolean') {
        throw new AppError('BAD_REQUEST', { field: 'published', reason: 'must_be_boolean' })
      }
      deps.admin.setPublished(request.params.id, published, actorOf(request))
      return { ok: true, data: { id: request.params.id, published } }
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/api/admin/products/:id',
    { preHandler: requireAdmin(deps.auth, 'product:write') },
    async (request): Promise<ApiResponse<{ deleted: true }>> => {
      deps.admin.remove(request.params.id, actorOf(request))
      return { ok: true, data: { deleted: true } }
    },
  )
}
