/**
 * 后台媒体路由（MD 域，`R` 层）。
 *
 * ## 上传用**裸请求体**，不用 multipart
 *
 * `POST /api/admin/media?filename=xxx.jpg`，`Content-Type: image/jpeg`，请求体就是文件字节。
 *
 * 为什么不用 multipart：multipart 的价值在于"一次传多个文件 + 附带表单字段"，
 * 而我们只需要**一个文件**（其余元数据走 URL 与响应）。为它引入 multipart 解析
 * 会带来一批已知陷阱 —— 部件顺序、字段与文件的交错、`limits` 配置、
 * 首部里的文件名需要转义（家族项目的索引里就记着 multipart 的坑）。
 *
 * 裸请求体只有一条规则：**Content-Type 就是文件的类型**。
 * 而它恰好也满足"服务端不信任前端"的要求 —— 类型由解析器白名单把关（见 app.ts）。
 *
 * ## 文件名走 querystring
 *
 * 因为裸请求体里没有地方放它。它**只用于展示**，不参与磁盘路径（见 media/port.ts）。
 */

import type { FastifyInstance } from 'fastify'
import type { ApiResponse, MediaAsset, Page } from '@oenpc-web/shared'
import { actorOf, requireAdmin } from '../../core/auth-context.js'
import { AppError } from '../../core/errors.js'
import type { AuthService } from '../../services/auth/service.js'
import type { MediaService } from '../../services/media/service.js'

export interface AdminMediaRouteDeps {
  auth: AuthService
  media: MediaService
}

function parsePositiveInt(raw: string | undefined, field: string, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) throw new AppError('BAD_REQUEST', { field, value: raw })
  return value
}

export function registerAdminMediaRoutes(app: FastifyInstance, deps: AdminMediaRouteDeps): void {
  app.get<{ Querystring: { page?: string; pageSize?: string } }>(
    '/api/admin/media',
    { preHandler: requireAdmin(deps.auth, 'media:read') },
    async (request): Promise<ApiResponse<Page<MediaAsset>>> => {
      const page = parsePositiveInt(request.query.page, 'page', 1)
      const pageSize = parsePositiveInt(request.query.pageSize, 'pageSize', 24)
      return { ok: true, data: deps.media.list(page, pageSize) }
    },
  )

  app.post<{ Querystring: { filename?: string } }>(
    '/api/admin/media',
    { preHandler: requireAdmin(deps.auth, 'media:write') },
    async (request): Promise<ApiResponse<MediaAsset>> => {
      /*
       * 解析器已保证 body 是 Buffer（见 app.ts 的 addContentTypeParser）。
       * 不是 Buffer 说明 Content-Type 不在白名单里 —— 那种请求根本进不来，
       * 但这里仍显式判一次，避免将来有人放宽解析器后出现"把对象当字节写盘"。
       */
      if (!Buffer.isBuffer(request.body)) {
        throw new AppError('UNSUPPORTED_MEDIA_TYPE', { contentType: String(request.headers['content-type']) })
      }

      const rawName = request.query.filename?.trim()
      const filename = rawName && rawName !== '' ? rawName.slice(0, 200) : 'upload'

      return {
        ok: true,
        data: deps.media.upload({
          filename,
          mime: String(request.headers['content-type']).split(';')[0]?.trim() ?? '',
          bytes: request.body,
          actor: actorOf(request),
        }),
      }
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/api/admin/media/:id',
    { preHandler: requireAdmin(deps.auth, 'media:delete') },
    async (request): Promise<ApiResponse<{ deleted: true }>> => {
      deps.media.remove(request.params.id, actorOf(request))
      return { ok: true, data: { deleted: true } }
    },
  )
}
