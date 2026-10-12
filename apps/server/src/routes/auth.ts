/**
 * 认证路由（AU 域）。
 *
 * ## 登录失败**不告诉前端**是哪里错了
 *
 * 用户名不存在、口令错误、账号停用 —— 一律 `UNAUTHORIZED`。
 * 前端因此只能显示"用户名或口令不正确"，这是**故意的**：
 * 更精确的提示等于送攻击者一个用户名枚举接口（见 `services/auth/service.ts` 文件头）。
 *
 * ## 限流用 429 而不是 401
 *
 * 触发限流时前端应当显示"尝试过于频繁，请稍后再试"，而不是"口令错误" ——
 * 否则用户会继续改口令重试，把锁定期一次次刷新。
 */

import type { FastifyInstance } from 'fastify'
import type { ApiResponse, LoginInput, LoginResult, AdminUser } from '@oenpc-web/shared'
import { currentAdmin, requireAdmin } from '../core/auth-context.js'
import { AppError } from '../core/errors.js'
import type { AuthService } from '../services/auth/service.js'

export interface AuthRouteDeps {
  auth: AuthService
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDeps): void {
  app.post<{ Body: LoginInput }>(
    '/api/auth/login',
    async (request): Promise<ApiResponse<LoginResult>> => {
      const { username, password } = request.body ?? ({} as LoginInput)

      if (typeof username !== 'string' || typeof password !== 'string' || username === '' || password === '') {
        throw new AppError('BAD_REQUEST', { field: 'username/password', reason: 'required' })
      }

      /*
       * `request.ip` 的值取决于 `trustProxy` 配置。**没配反向代理时会拿到 A 机的 IP**，
       * 于是限流退化成"全站共用一个计数器" —— 见 app.ts 与 .env.example 的说明。
       */
      return { ok: true, data: deps.auth.login(username, password, request.ip) }
    },
  )

  app.post(
    '/api/auth/logout',
    { preHandler: requireAdmin(deps.auth) },
    async (request): Promise<ApiResponse<{ loggedOut: true }>> => {
      const token = request.authToken
      if (token) deps.auth.logout(token)
      /* 幂等：令牌本来就无效时也返回成功 —— 前端的期望是"我登出了" */
      return { ok: true, data: { loggedOut: true } }
    },
  )

  app.get(
    '/api/auth/me',
    { preHandler: requireAdmin(deps.auth) },
    async (request): Promise<ApiResponse<AdminUser>> => ({ ok: true, data: currentAdmin(request) }),
  )
}
