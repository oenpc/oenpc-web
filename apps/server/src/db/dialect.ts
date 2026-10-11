/**
 * SQL 方言适配层 —— 全仓库**唯一**允许出现 SQLite 专有语法的地方。
 *
 * ## 它存在的理由（约束 portable-sql）
 *
 * 需求里写了「预留 PostgreSQL 对接」。若 SQLite 专有语法散落在几十个仓储实现里，
 * 切 PG 时就要逐处改写 —— 那时"预留"只是一句空话。
 * 把方言差异**收进这一个文件**之后，「可移植性」就从一个愿望变成了
 * 一条可机械检查的性质：`pnpm strata:check` 会扫描所有 ⟨D⟩ 层的文件，
 * 专有语法只允许出现在带 `strata-allow-dialect` 标记的行上。
 *
 * ## 参数占位符的差异（检查器检测不到，靠这条注释）
 *
 * node:sqlite 用 `?`，PostgreSQL 用 `$1`。
 * **仓储实现统一写 `?`**，由 PG 实现负责翻译成 `$n` —— 这样仓储代码不必分叉。
 * 文本启发式无法区分二者（`?` 也可能是三元运算符），所以这条靠评审保证。
 *
 * ## 能不用专有语法就不用
 *
 * 注意 upsert 用的是 `INSERT ... ON CONFLICT ... DO UPDATE`，
 * 它在 SQLite ≥3.24 与 PostgreSQL ≥9.5 上都成立 —— **不要**改写成
 * `INSERT OR REPLACE`，那才是 SQLite 专有的，而且语义不同
 * （`OR REPLACE` 会**删除**冲突行再插入，触发外键级联删除，是个隐蔽的数据丢失源）。
 */

import type { DatabaseSync } from 'node:sqlite'

/**
 * 连接级设置。
 *
 * 这几条都是 SQLite 专有的 `PRAGMA`；PG 侧对应的是连接参数或实例级配置。
 */
export function applyConnectionPragmas(db: DatabaseSync): void {
  // strata-allow-dialect 并发：WAL 让读不阻塞写，是单机多连接的前提
  db.exec('PRAGMA journal_mode = WAL')
  // strata-allow-dialect 外键约束默认关闭，必须显式打开，否则级联删除静默失效
  db.exec('PRAGMA foreign_keys = ON')
  // strata-allow-dialect 写锁等待；不设会立刻抛 SQLITE_BUSY（陷阱 P-13）
  db.exec('PRAGMA busy_timeout = 5000')
}

/**
 * 业务时间的**唯一**来源。
 *
 * 存储与传输一律 ISO8601 **UTC**；时区转换只发生在展示层（硬约束 `utc-storage`）。
 *
 * **不要改用 SQL 的 `datetime('now')`**，两个理由：
 *   1. 它是 SQLite 专有（PG 用 `now()`），会把方言差异漏出本文件；
 *   2. 它会绕过这一处收口，导致库里出现两种格式的时间串 ——
 *      而 SQLite 没有原生 datetime 类型，格式一乱，排序与区间查询就会静默出错（陷阱 P-12）。
 */
export function nowIsoUtc(): string {
  return new Date().toISOString()
}

/**
 * JSON 列的写入。
 *
 * SQLite 没有 JSON 类型，JSON 存在 TEXT 列里；PG 侧会换成 `jsonb`。
 * 序列化方式收口在这里，PG 实现只需要改这一个函数。
 */
export function toJsonColumn(value: unknown): string {
  return JSON.stringify(value)
}

/**
 * JSON 列的读取。
 *
 * **解析失败时返回 fallback 而不是抛错** —— 一个损坏的 JSON 列不该让整页 500。
 * 但它也不该被静默吞掉，所以调用方应当能选择记日志（见仓储实现）。
 */
export function fromJsonColumn<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || raw === '') return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}
