/**
 * 数据库连接管理。
 *
 * 用 Node 内置的 `node:sqlite`（`DatabaseSync`）—— 零第三方依赖，
 * 这也是 `engines.node >= 22.19.0` 的原因。
 *
 * ## 单进程写入
 *
 * SQLite 在同一时刻只允许一个写事务。本项目的部署形态是**单机单实例**
 * （B 机一个 node 进程），所以这不是瓶颈；但一旦出现多进程共用一个库，
 * 就会撞上 `SQLITE_BUSY`（已在方言层设 `busy_timeout` 缓解）。
 * 真要水平扩展时必须换 PostgreSQL —— 那正是 `PG` 预留要解决的问题。
 *
 * ## 目录自动创建
 *
 * `data/` 与 `data/media/` 是被 `.gitignore` 忽略的运行期目录，
 * 首次启动时不存在是正常的，所以这里负责创建 —— 但**只创建目录**，
 * 不预置任何业务数据（首次建库由迁移负责）。
 */

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { applyConnectionPragmas } from './dialect.js'

export interface OpenedDatabase {
  db: DatabaseSync
  /** 实际使用的绝对路径 —— 排查"数据写哪去了"时先看它。 */
  path: string
  close: () => void
}

/**
 * 打开（必要时创建）数据库。
 *
 * @param dbPath 相对路径按 `cwd` 解析 —— 见 `config.ts` 的说明。
 */
export function openDatabase(dbPath: string): OpenedDatabase {
  const absolute = resolve(dbPath)
  mkdirSync(dirname(absolute), { recursive: true })

  const db = new DatabaseSync(absolute)
  applyConnectionPragmas(db)

  return {
    db,
    path: absolute,
    close: () => db.close(),
  }
}
