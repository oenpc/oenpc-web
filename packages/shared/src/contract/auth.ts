/**
 * 后台账号契约（AU 域）。
 *
 * ## ⚠ 这里**绝不能**出现 `password_hash` / `password_salt`
 *
 * 契约包是前后端共享的。一旦在这里定义了摘要字段，迟早会有人
 * "顺手"把它序列化进某个接口的响应里 —— 而那是一次静默的凭据泄露，
 * 且不会有任何测试失败。口令摘要**只存在于服务端的行类型**里
 * （`apps/server/src/repositories/auth/port.ts` 的 `AuthUserRecord`）。
 */

import type { Permission } from '../permissions.js'

/** 给前端看的账号信息。不含任何凭据材料。 */
export interface AdminUser {
  id: string
  username: string
  displayName: string
  /** 隐式全权：为 true 时 `permissions` 不参与判定。 */
  isOwner: boolean
  permissions: Permission[]
  disabled: boolean
  createdAt: string
}

export interface LoginInput {
  username: string
  password: string
}

export interface LoginResult {
  /** 明文令牌 —— **只在登录响应里出现这一次**，服务端只存它的哈希。 */
  token: string
  expiresAt: string
  user: AdminUser
}
