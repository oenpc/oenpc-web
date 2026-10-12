/**
 * 认证上下文（`C` 层）—— 把"这个请求带没带有效会话"变成可复用的 preHandler。
 *
 * ## 为什么合成**一个** preHandler 而不是两个
 *
 * Fastify 的 preHandler 数组是顺序执行的，用两个（先解析再判权限）意味着
 * 第二个必须依赖第一个的副作用，于是要写 `request.adminUser!` 这种断言 ——
 * 而一旦有人调整了数组顺序，它就变成运行时崩溃。
 * 合成一个之后，"取用户 + 判权限"是一次原子操作，顺序不可能错。
 *
 * ## 令牌只从 `Authorization: Bearer` 取
 *
 * **不用 Cookie**。部署是 A 机 nginx 反代到 B 机，虽然同源，
 * 但 Cookie 会带来 `SameSite` / `Secure` / CSRF 一整套问题，
 * 而 Bearer 头天然不受 CSRF 影响（浏览器不会自动携带它）。
 * 代价是前端得自己存令牌 —— 后台是内部系统，这个代价可接受。
 */

import type { FastifyRequest } from 'fastify'
import type { AdminUser, Permission } from '@oenpc-web/shared'
import { assertPermission, type AuthService } from '../services/auth/service.js'
import { AppError } from './errors.js'

declare module 'fastify' {
  interface FastifyRequest {
    /** 已通过认证的后台用户。只有通过 `requireAdmin` 的请求才有值。 */
    adminUser?: AdminUser
    /** 当前会话令牌，登出时要用。 */
    authToken?: string
  }
}

function extractBearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization
  if (typeof header !== 'string') return null
  if (!header.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length).trim()
  return token === '' ? null : token
}

/**
 * 生成一个要求后台登录（可选再要求某个权限）的 preHandler。
 *
 * @param permission 省略则只要求登录。
 */
export function requireAdmin(
  auth: AuthService,
  permission?: Permission,
): (request: FastifyRequest) => Promise<void> {
  return async (request) => {
    const token = extractBearerToken(request)
    if (!token) throw new AppError('UNAUTHORIZED')

    /* 会话无效/过期/账号被停用都会在这里抛 UNAUTHORIZED —— 判定只在 auth 服务一处 */
    const user = auth.resolveSession(token)

    if (permission) assertPermission(user, permission)

    request.adminUser = user
    request.authToken = token
  }
}

/**
 * 取当前用户。**只应在已挂 `requireAdmin` 的路由里调用** ——
 * 取不到就抛 500 而不是 401：那说明路由配置错了（忘了挂守卫），
 * 是一个**程序缺陷**而不是"用户没登录"，报 401 会掩盖这个问题。
 */
export function currentAdmin(request: FastifyRequest): AdminUser {
  if (!request.adminUser) {
    throw new Error('路由未挂 requireAdmin 守卫 —— 这是程序缺陷，不是未登录')
  }
  return request.adminUser
}

/** 审计用的主体形状。 */
export function actorOf(request: FastifyRequest): { id: string; name: string } {
  const user = currentAdmin(request)
  return { id: user.id, name: user.username }
}
