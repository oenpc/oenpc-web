/**
 * 账号与会话的**端口**（AU 域）—— 与具体数据库驱动无关。
 *
 * ## ⚠ 这个文件里的 `AuthUserRecord` **含凭据材料**
 *
 * `passwordSalt` / `passwordHash` 属于服务端内部。它**不能**出现在
 * `packages/shared` 的契约里（那是前后端共享的），也不能被任何路由直接返回。
 * 对外转换发生在 `services/auth/service.ts` 的 `toAdminUser()` —— 那是唯一的出口。
 */

import type { Permission } from '@oenpc-web/shared'

/** 服务端行类型：含凭据材料，**绝不离开服务端**。 */
export interface AuthUserRecord {
  id: string
  username: string
  passwordSalt: string
  passwordHash: string
  displayName: string
  permissions: Permission[]
  isOwner: boolean
  disabled: boolean
  createdAt: string
  updatedAt: string
}

export interface SessionRecord {
  /** 令牌的 sha256 —— **明文令牌从不落库**。 */
  tokenHash: string
  userId: string
  createdAt: string
  expiresAt: string
  lastSeenAt: string
}

export interface CreateUserInput {
  id: string
  username: string
  passwordSalt: string
  passwordHash: string
  displayName: string
  permissions: Permission[]
  isOwner: boolean
  now: string
}

export interface AuthRepository {
  findUserByUsername(username: string): AuthUserRecord | null
  findUserById(id: string): AuthUserRecord | null
  countUsers(): number
  createUser(input: CreateUserInput): AuthUserRecord

  createSession(session: SessionRecord): void
  /** 按令牌哈希取会话。调用方负责判过期 —— 这样"过期"的判定只有一处。 */
  findSession(tokenHash: string): SessionRecord | null
  touchSession(tokenHash: string, at: string): void
  deleteSession(tokenHash: string): void
  /** 改口令或停用账号时一次性踢掉全部会话。 */
  deleteSessionsForUser(userId: string): number
  /** 清掉已过期的会话，避免表无限增长。返回清除条数。 */
  deleteExpiredSessions(nowIso: string): number
}
