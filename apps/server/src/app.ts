/**
 * Fastify 应用装配（`E` 层）—— 同时是 HTTP 层的**组合根**。
 *
 * ## 这个文件承担的两件跨服务器拓扑决策
 *
 * ### 1. `trustProxy` —— 不配它，按 IP 限流就会失效
 *
 * 部署是 A 机（nginx + 静态站点）反代到 B 机（本进程）。**若本进程不信任
 * `X-Forwarded-For`，它看到的每个请求来源都是 A 机的 IP** —— 于是：
 *   · 日志里所有访客是同一个 IP，排查攻击来源时完全无用；
 *   · 登录限流（F7.5）会把**所有访客当成同一个人**，触发一次就把全站用户一起封在门外。
 *
 * 但 `trustProxy: true` 是**危险的默认值**：它让客户端可以伪造
 * `X-Forwarded-For` 来绕过基于 IP 的限流。所以这里从配置读，
 * **默认关闭**，由部署方显式指定可信代理。
 *
 * ### 2. 错误处理器是**唯一**出口，消息不透传
 *
 * 未知异常的原始 message 可能含 SQL、文件路径、内部标识。
 * 直接返回给前端等于信息泄露，而这类泄露往往在安全评审前无人察觉。
 * 所以：对外只给码与结构化 meta，完整信息进服务端日志。
 *
 * ## 上传为什么不用 multipart
 *
 * 见 `routes/admin/media.ts` 的说明：单个文件用裸请求体更简单，
 * 也避开了 multipart 的一批已知陷阱。这里的 `addContentTypeParser`
 * 就是它的服务端一半 —— **类型白名单在解析器层就把关**，
 * 非图片的 Content-Type 根本进不到路由。
 */

import Fastify, { type FastifyInstance } from 'fastify'
import type { ApiErr } from '@oenpc-web/shared'
import type { ServerConfig } from './config.js'
import { toAppError } from './core/errors.js'
import { createAuthService, type AuthService } from './services/auth/service.js'
import { createMediaService, MAX_UPLOAD_BYTES, type MediaService } from './services/media/service.js'
import { createProductAdminService, type ProductAdminService } from './services/products/admin.js'
import type { AuthRepository } from './repositories/auth/port.js'
import type { AuditRepository } from './repositories/audit/port.js'
import type { MediaRepository } from './repositories/media/port.js'
import type { ProductRepository } from './repositories/products/port.js'
import { registerAdminMediaRoutes } from './routes/admin/media.js'
import { registerAdminProductRoutes } from './routes/admin/products.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerHealthRoutes } from './routes/health.js'
import { registerPublicMediaRoutes } from './routes/media.js'
import { registerProductRoutes } from './routes/products/index.js'

/**
 * 允许上传的 Content-Type 白名单。
 *
 * **与 `services/media/service.ts` 的 `ALLOWED_MIME` 必须一致** ——
 * 这里的解析器决定"请求能不能进到路由"，那里的服务决定"字节能不能落盘"。
 * 两处都拦一次是有意的：只拦一处时，改错任何一处都会让另一处形同虚设。
 * **不含 `image/svg+xml`**（理由见 media 服务文件头：SVG 可内嵌脚本）。
 */
const UPLOAD_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const

export interface AppDeps {
  config: ServerConfig
  /**
   * 各域的仓储**端口**，不是数据库连接。
   *
   * 这是 P0.1 抽仓储接口的直接收益：`app.ts` 不再认识 `DatabaseSync`，
   * 换驱动时改的是 `index.ts` 的装配，不是这里。
   */
  repositories: {
    products: ProductRepository
    auth: AuthRepository
    audit: AuditRepository
    media: MediaRepository
  }
  databasePath: string
  appliedMigrations: number
  startedAtMs: number
}

export interface BuiltApp {
  app: FastifyInstance
  services: {
    auth: AuthService
    media: MediaService
    productsAdmin: ProductAdminService
  }
}

export function buildApp(deps: AppDeps): BuiltApp {
  const app = Fastify({
    logger: { level: deps.config.logLevel },
    trustProxy: deps.config.trustedProxy,
  })

  /* ── 服务装配（HTTP 层的组合根） ── */

  const auth = createAuthService({ auth: deps.repositories.auth, audit: deps.repositories.audit })

  const media = createMediaService({
    media: deps.repositories.media,
    audit: deps.repositories.audit,
    mediaDir: deps.config.mediaDir,
  })

  const productsAdmin = createProductAdminService({
    products: deps.repositories.products,
    audit: deps.repositories.audit,
    /* 注入"媒体是否存在"而不是直接依赖媒体仓储，避免 PD 与 MD 两个域互相耦合 */
    mediaExists: (id) => deps.repositories.media.getById(id) !== null,
  })

  /* ── 上传：类型白名单在解析器层把关 ── */

  for (const contentType of UPLOAD_CONTENT_TYPES) {
    app.addContentTypeParser(
      contentType,
      { parseAs: 'buffer', bodyLimit: MAX_UPLOAD_BYTES },
      (_request, body, done) => done(null, body),
    )
  }

  /* ── 错误出口 ── */

  app.setErrorHandler((error, request, reply) => {
    const appError = toAppError(error)

    /*
     * 5xx 记 error、4xx 记 warn。
     * 把 4xx 也记成 error 会让日志被爬虫与扫描器刷满，真正的问题反而被淹掉。
     */
    if (appError.status >= 500) {
      request.log.error({ err: error, code: appError.code }, '请求失败')
    } else {
      request.log.warn({ code: appError.code, meta: appError.meta }, '请求被拒绝')
    }

    const body: ApiErr = {
      ok: false,
      code: appError.code,
      ...(appError.meta ? { meta: appError.meta } : {}),
    }
    reply.status(appError.status).send(body)
  })

  /*
   * 未匹配的路由也走信封 —— 否则前端拿到的是 Fastify 的默认 HTML/JSON，
   * 与契约不符，客户端解析会炸在类型断言上。
   */
  app.setNotFoundHandler((_request, reply) => {
    const body: ApiErr = { ok: false, code: 'NOT_FOUND' }
    reply.status(404).send(body)
  })

  /* ── 路由 ── */

  registerHealthRoutes(app, {
    databasePath: deps.databasePath,
    appliedMigrations: deps.appliedMigrations,
    startedAtMs: deps.startedAtMs,
  })

  /* 公开站点的读接口与媒体 */
  registerProductRoutes(app, { products: deps.repositories.products })
  registerPublicMediaRoutes(app, { media })

  /* 后台 */
  registerAuthRoutes(app, { auth })
  registerAdminProductRoutes(app, { auth, admin: productsAdmin, products: deps.repositories.products })
  registerAdminMediaRoutes(app, { auth, media })

  return { app, services: { auth, media, productsAdmin } }
}
