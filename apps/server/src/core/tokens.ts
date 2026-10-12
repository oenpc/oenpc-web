/**
 * 会话令牌 —— **服务端会话**，不是 JWT。
 *
 * ## 为什么用会话表而不是 JWT
 *
 * JWT 的优势是无状态（不用查库），代价是**无法注销**：签发出去的令牌到期前一直有效。
 * 对一个后台管理系统来说这是不可接受的 —— "退出登录"必须真的让令牌失效，
 * 而"改了口令但旧令牌还能用"是更严重的问题。
 *
 * 会话表还省掉了签名密钥的管理（生成、保管、轮换、泄露后的紧急替换），
 * 而密钥管理恰恰是最容易做错、且错了最难发现的一环。
 *
 * 代价是每个请求多一次库查询。本项目是单机 SQLite、后台只有几个人，
 * 这个代价可以忽略；**水平扩展时要换成共享存储**（Redis 或数据库）。
 *
 * ## 令牌本身不落库，只落它的哈希
 *
 * 库里存 `sha256(token)`。这样**即使数据库泄露，攻击者也拿不到可用的令牌** ——
 * 与口令存摘要同一个道理。校验时算哈希再比对。
 *
 * 注：这里用裸 SHA-256 而不是 scrypt 是**故意的** —— 令牌是 32 字节的高熵随机值，
 * 不存在字典攻击的空间，不需要慢哈希；而慢哈希会让每个请求都付出一次 scrypt 的开销。
 */

import { createHash, randomBytes } from 'node:crypto'

/** 令牌字节数。32 字节 = 256 bit，暴力猜解不可行。 */
const TOKEN_BYTES = 32

/** 会话有效期（天）。到期必须重新登录。 */
export const SESSION_TTL_DAYS = 7

export interface SessionToken {
  /** 返回给客户端的明文令牌 —— **只在登录响应里出现这一次**。 */
  token: string
  /** 存库的哈希。 */
  tokenHash: string
}

export function createSessionToken(): SessionToken {
  const token = randomBytes(TOKEN_BYTES).toString('base64url')
  return { token, tokenHash: hashToken(token) }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** 从现在起 N 天后的 ISO8601 UTC 时刻。 */
export function expiresAtFromNow(days: number = SESSION_TTL_DAYS, now: Date = new Date()): string {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString()
}
