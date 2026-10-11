/**
 * Fastify 应用装配（`E` 层）。
 *
 * ## 这个文件承担的两件跨服务器拓扑决策
 *
 * ### 1. `trustProxy` —— 不配它，按 IP 限流就会失效
 *
 * 部署是 A 机（nginx + 静态站点）反代到 B 机（本进程）。**若本进程不信任
 * `X-Forwarded-For`，它看到的每个请求来源都是 A 机的 IP** ——
 * 于是：
 *   · 日志里所有访客是同一个 IP，排查攻击来源时完全无用；
 *   · 登录限流（功能清单 F7.5）会把**所有访客当成同一个人**，
 *     触发一次就把全站用户一起封在门外。
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
 */

import Fastify, { type FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import type { ApiErr } from '@oenpc-web/shared'
import type { ServerConfig } from './config.js'
import { toAppError } from './core/errors.js'
import { registerHealthRoutes } from './routes/health.js'
import { registerProductRoutes } from './routes/products/index.js'

export interface AppDeps {
  db: DatabaseSync
  config: ServerConfig
  /** 数据库实际绝对路径，健康检查会回报它。 */
  databasePath: string
  appliedMigrations: number
  startedAtMs: number
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: { level: deps.config.logLevel },
    trustProxy: deps.config.trustedProxy,
  })

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

  registerHealthRoutes(app, {
    databasePath: deps.databasePath,
    appliedMigrations: deps.appliedMigrations,
    startedAtMs: deps.startedAtMs,
  })

  registerProductRoutes(app, { db: deps.db })

  return app
}
