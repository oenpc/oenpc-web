/**
 * 登录限流 —— **极简内存实现**。
 *
 * ## 必须说清的局限（不要假装它是生产级的）
 *
 * 1. **进程重启即清零** —— 攻击者若能触发重启（或服务恰好重启），计数就没了。
 * 2. **多进程 / 多实例之间不共享** —— 水平扩展后每个实例各算一份，实际阈值变成 N 倍。
 *
 * 对当前的部署形态（单机单实例、后台只有几个人）够用。
 * **要真正防住分布式爆破，必须换成共享存储**（Redis 或数据库计数）。
 *
 * ## 为什么按 `IP + 用户名` 组合键计数
 *
 * 只按 IP：一个办公室共用一个出口 IP，一个人输错几次就把全办公室锁住。
 * 只按用户名：攻击者可以用大量用户名绕过（每个用户名只试几次）。
 * 组合键能同时挡住这两类：既限制"针对某个账号的爆破"，也限制"来自某个 IP 的撒网"。
 *
 * ## 这个限流与 `trustProxy` 是耦合的（重要）
 *
 * 若部署在反向代理后而没配 `trustProxy`，**所有请求的来源 IP 都是代理的 IP** ——
 * 于是限流退化成"全站共用一个计数器"，一次爆破就把所有管理员锁在门外。
 * 见 `apps/server/src/app.ts` 与 `.env.example` 的说明。
 */

export interface RateLimitDecision {
  allowed: boolean
  /** 还需要等多少秒（被拒绝时有意义）。 */
  retryAfterSeconds: number
}

export interface LoginRateLimiter {
  /** 登录**失败**时调用。 */
  recordFailure(key: string): void
  /** 登录**成功**时调用 —— 清掉计数，避免正常用户被自己之前的输错拖累。 */
  recordSuccess(key: string): void
  check(key: string): RateLimitDecision
  /** 供测试用：清空全部计数。 */
  reset(): void
}

export interface LoginRateLimiterOptions {
  /** 窗口内允许的失败次数。 */
  maxAttempts?: number
  /** 计数窗口（毫秒）。 */
  windowMs?: number
  /** 超出阈值后的锁定时长（毫秒）。 */
  lockMs?: number
  /** 注入时钟，便于测试。 */
  now?: () => number
}

export function createLoginRateLimiter(options: LoginRateLimiterOptions = {}): LoginRateLimiter {
  const maxAttempts = options.maxAttempts ?? 8
  const windowMs = options.windowMs ?? 15 * 60 * 1000
  const lockMs = options.lockMs ?? 15 * 60 * 1000
  const now = options.now ?? (() => Date.now())

  interface Entry {
    failures: number[]
    lockedUntil: number
  }
  const entries = new Map<string, Entry>()

  /* 惰性清理：只在访问时顺手清，不引入定时器（定时器会让进程难以优雅退出） */
  function entryFor(key: string): Entry {
    const current = now()
    const existing = entries.get(key)
    if (!existing) {
      const created: Entry = { failures: [], lockedUntil: 0 }
      entries.set(key, created)
      return created
    }
    existing.failures = existing.failures.filter((at) => current - at < windowMs)
    if (existing.lockedUntil !== 0 && current >= existing.lockedUntil) existing.lockedUntil = 0
    return existing
  }

  return {
    recordFailure(key) {
      const entry = entryFor(key)
      entry.failures.push(now())
      if (entry.failures.length >= maxAttempts) entry.lockedUntil = now() + lockMs
    },

    recordSuccess(key) {
      entries.delete(key)
    },

    check(key) {
      const entry = entryFor(key)
      const current = now()
      if (entry.lockedUntil > current) {
        return { allowed: false, retryAfterSeconds: Math.ceil((entry.lockedUntil - current) / 1000) }
      }
      return { allowed: true, retryAfterSeconds: 0 }
    },

    reset() {
      entries.clear()
    },
  }
}

/** 组装限流键：客户端 IP + 用户名（小写，避免大小写绕过）。 */
export function loginRateLimitKey(ip: string, username: string): string {
  return `${ip}|${username.trim().toLowerCase()}`
}
