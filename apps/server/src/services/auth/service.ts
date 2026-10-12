/**
 * 认证服务（AU 域）。
 *
 * ## 两条安全上的硬性要求
 *
 * ### 1. 登录失败**不区分**"用户名不存在"与"口令错误"
 *
 * 两者都返回同一个 `UNAUTHORIZED`。区分开就等于给攻击者一个**用户名枚举接口** ——
 * 他可以先把有效用户名筛出来，再针对性地爆破。
 *
 * ### 2. 用户不存在时**照样跑一次口令校验**
 *
 * 否则"用户不存在"会比"口令错误"返回得快得多，攻击者靠**响应时间**就能枚举用户名。
 * 这是时序侧信道，本地网络下可测量。下面的 `dummyDigest` 就是为此存在的。
 *
 * ## 会话校验只在这里判过期
 *
 * 仓储只负责按令牌哈希取会话，**过期判定只有这一处** ——
 * 分散判过期最常见的后果是某个入口忘了判，于是"过期会话仍能用"。
 */

import { randomUUID } from 'node:crypto'
import type { AdminUser, LoginResult, Permission } from '@oenpc-web/shared'
import { AppError } from '../../core/errors.js'
import { verifyPassword } from '../../core/passwords.js'
import { createLoginRateLimiter, loginRateLimitKey, type LoginRateLimiter } from '../../core/rate-limit.js'
import { createSessionToken, expiresAtFromNow, hashToken } from '../../core/tokens.js'
import type { AuthRepository, AuthUserRecord } from '../../repositories/auth/port.js'
import type { AuditRepository } from '../../repositories/audit/port.js'

export interface AuthServiceDeps {
  auth: AuthRepository
  audit: AuditRepository
  /** 注入时钟，便于测试。 */
  now?: () => Date
  rateLimiter?: LoginRateLimiter
}

/**
 * 一个固定的假摘要，用于"用户不存在"时**照常消耗一次 scrypt 时间**。
 * 它对应一个不可能被输入出来的口令，所以校验必然失败。
 */
const DUMMY_DIGEST = {
  salt: '00000000000000000000000000000000',
  hash: '0'.repeat(128),
}

/** 服务端行 → 对外形状。**这是剥离凭据材料的唯一出口。** */
export function toAdminUser(record: AuthUserRecord): AdminUser {
  return {
    id: record.id,
    username: record.username,
    displayName: record.displayName,
    isOwner: record.isOwner,
    permissions: record.permissions,
    disabled: record.disabled,
    createdAt: record.createdAt,
  }
}

/**
 * 权限断言。
 *
 * `isOwner` 是**隐式全权**：直接放行，不看 `permissions` 列表。
 * 否则每新增一个权限点都要回头补超管，而漏补的症状是
 * "超管突然失去新功能"，很难联想到权限配置。
 */
export function assertPermission(user: AdminUser, permission: Permission): void {
  if (user.isOwner) return
  if (!user.permissions.includes(permission)) {
    throw new AppError('FORBIDDEN', { permission })
  }
}

export interface AuthService {
  login(username: string, password: string, clientIp: string): LoginResult
  resolveSession(token: string): AdminUser
  logout(token: string): void
  /** 清掉过期会话，避免表无限增长。启动时调用一次即可。 */
  purgeExpiredSessions(): number
}

export function createAuthService(deps: AuthServiceDeps): AuthService {
  const now = deps.now ?? (() => new Date())
  const rateLimiter = deps.rateLimiter ?? createLoginRateLimiter()

  function audit(action: string, actorId: string | null, actorName: string, detail?: Record<string, unknown>) {
    /*
     * 审计写入失败**不让登录失败** —— "审计少一条"比"所有人都登不进来"轻。
     * 需要强一致的场景应把两者放进同一事务；本项目没到那个强度（见 audit/sqlite.ts 的说明）。
     */
    try {
      deps.audit.append({
        id: randomUUID(),
        actorId,
        actorName,
        action,
        now: now().toISOString(),
        ...(detail ? { detail } : {}),
      })
    } catch (error) {
      console.error('[audit] 写入失败（已忽略，不影响业务）：', error)
    }
  }

  return {
    login(username, password, clientIp) {
      const key = loginRateLimitKey(clientIp, username)
      const decision = rateLimiter.check(key)
      if (!decision.allowed) {
        audit('auth.login.rate_limited', null, username, { retryAfterSeconds: decision.retryAfterSeconds })
        throw new AppError('RATE_LIMITED', { retryAfterSeconds: decision.retryAfterSeconds })
      }

      const record = deps.auth.findUserByUsername(username)

      /*
       * 用户不存在时**照样跑一次 scrypt**：否则响应时间会暴露"这个用户名不存在"。
       * 见文件头第 2 条。
       */
      const passwordOk = record
        ? verifyPassword(password, { salt: record.passwordSalt, hash: record.passwordHash })
        : (verifyPassword(password, DUMMY_DIGEST), false)

      if (!record || !passwordOk || record.disabled) {
        rateLimiter.recordFailure(key)
        /*
         * 三种失败原因**返回同一个错误**，不区分 —— 见文件头第 1 条。
         * 但审计里记下真实原因，那是给管理员看的，不是给攻击者看的。
         */
        audit('auth.login.failed', record?.id ?? null, username, {
          reason: !record ? 'no_such_user' : record.disabled ? 'disabled' : 'bad_password',
        })
        throw new AppError('UNAUTHORIZED')
      }

      rateLimiter.recordSuccess(key)

      const token = createSessionToken()
      const expiresAt = expiresAtFromNow(undefined, now())
      deps.auth.createSession({
        tokenHash: token.tokenHash,
        userId: record.id,
        createdAt: now().toISOString(),
        expiresAt,
        lastSeenAt: now().toISOString(),
      })

      audit('auth.login', record.id, record.username)

      return { token: token.token, expiresAt, user: toAdminUser(record) }
    },

    resolveSession(token) {
      const session = deps.auth.findSession(hashToken(token))
      if (!session) throw new AppError('UNAUTHORIZED')

      /* 过期判定**只在这一处** —— 见文件头 */
      if (session.expiresAt <= now().toISOString()) {
        deps.auth.deleteSession(session.tokenHash)
        throw new AppError('UNAUTHORIZED')
      }

      const user = deps.auth.findUserById(session.userId)
      if (!user || user.disabled) {
        /* 账号被停用后，手上还没过期的会话必须立刻失效 */
        deps.auth.deleteSession(session.tokenHash)
        throw new AppError('UNAUTHORIZED')
      }

      deps.auth.touchSession(session.tokenHash, now().toISOString())
      return toAdminUser(user)
    },

    logout(token) {
      const tokenHash = hashToken(token)
      const session = deps.auth.findSession(tokenHash)
      if (session) {
        const user = deps.auth.findUserById(session.userId)
        audit('auth.logout', session.userId, user?.username ?? '')
      }
      deps.auth.deleteSession(tokenHash)
    },

    purgeExpiredSessions() {
      return deps.auth.deleteExpiredSessions(now().toISOString())
    },
  }
}
