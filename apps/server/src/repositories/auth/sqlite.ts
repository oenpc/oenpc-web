/**
 * `AuthRepository` 端口的 **SQLite 实现**（AU 域）。
 *
 * 可移植性：本文件的 DDL/DML 没有 SQLite 专有语法（无 `AUTOINCREMENT`、
 * 无 `INSERT OR REPLACE`、无 `datetime('now')`）—— 由 `portable-sql` 守着。
 * 检查器检测不到的两处方言差异仍适用：占位符 `?` vs `$1`、`LIKE` 大小写敏感性。
 */

import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import type { Permission } from '@oenpc-web/shared'
import { isPermission } from '@oenpc-web/shared'
import type { AuthRepository, AuthUserRecord, CreateUserInput, SessionRecord } from './port.js'

interface UserRow {
  id: string
  username: string
  password_salt: string
  password_hash: string
  display_name: string
  permissions_json: string
  is_owner: number
  disabled: number
  created_at: string
  updated_at: string
}

interface SessionRow {
  token_hash: string
  user_id: string
  created_at: string
  expires_at: string
  last_seen_at: string
}

function queryOne<T>(db: DatabaseSync, sql: string, params: SQLInputValue[] = []): T | undefined {
  return db.prepare(sql).get(...params) as unknown as T | undefined
}

function queryAll<T>(db: DatabaseSync, sql: string, params: SQLInputValue[] = []): T[] {
  return db.prepare(sql).all(...params) as unknown as T[]
}

/**
 * 解析权限列表，**丢弃不认识的权限点**。
 *
 * 库里可能留有已废弃的权限点（重构、回滚、手工改库）。
 * 原样透传会让前端的权限勾选界面出现无意义的选项，
 * 而按未知权限点放行则是越权 —— 所以这里丢弃，并且只接受**已知枚举**内的值。
 */
function parsePermissions(raw: string): Permission[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed.filter((value): value is Permission => typeof value === 'string' && isPermission(value))
}

function toRecord(row: UserRow): AuthUserRecord {
  return {
    id: row.id,
    username: row.username,
    passwordSalt: row.password_salt,
    passwordHash: row.password_hash,
    displayName: row.display_name,
    permissions: parsePermissions(row.permissions_json),
    /* SQLite 存 INTEGER 0/1；契约里是 boolean（PG 有真 boolean）—— 转换收口在这里 */
    isOwner: row.is_owner === 1,
    disabled: row.disabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toSession(row: SessionRow): SessionRecord {
  return {
    tokenHash: row.token_hash,
    userId: row.user_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
  }
}

export function createSqliteAuthRepository(db: DatabaseSync): AuthRepository {
  return {
    findUserByUsername(username) {
      /* 用户名统一按小写存储与查询，避免 `Admin` / `admin` 变成两个账号 */
      const row = queryOne<UserRow>(db, 'SELECT * FROM app_user WHERE username = ?', [
        username.trim().toLowerCase(),
      ])
      return row ? toRecord(row) : null
    },

    findUserById(id) {
      const row = queryOne<UserRow>(db, 'SELECT * FROM app_user WHERE id = ?', [id])
      return row ? toRecord(row) : null
    },

    countUsers() {
      const row = queryOne<{ total: number }>(db, 'SELECT COUNT(*) AS total FROM app_user')
      return row?.total ?? 0
    },

    createUser(input: CreateUserInput) {
      db.prepare(
        `INSERT INTO app_user
           (id, username, password_salt, password_hash, display_name, permissions_json, is_owner, disabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      ).run(
        input.id,
        input.username.trim().toLowerCase(),
        input.passwordSalt,
        input.passwordHash,
        input.displayName,
        JSON.stringify(input.permissions),
        input.isOwner ? 1 : 0,
        input.now,
        input.now,
      )
      const created = this.findUserById(input.id)
      if (!created) throw new Error(`创建用户后读不回来：${input.id}`)
      return created
    },

    createSession(session) {
      db.prepare(
        `INSERT INTO app_session (token_hash, user_id, created_at, expires_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(session.tokenHash, session.userId, session.createdAt, session.expiresAt, session.lastSeenAt)
    },

    findSession(tokenHash) {
      const row = queryOne<SessionRow>(db, 'SELECT * FROM app_session WHERE token_hash = ?', [tokenHash])
      return row ? toSession(row) : null
    },

    touchSession(tokenHash, at) {
      db.prepare('UPDATE app_session SET last_seen_at = ? WHERE token_hash = ?').run(at, tokenHash)
    },

    deleteSession(tokenHash) {
      db.prepare('DELETE FROM app_session WHERE token_hash = ?').run(tokenHash)
    },

    deleteSessionsForUser(userId) {
      const before = queryAll<{ token_hash: string }>(
        db,
        'SELECT token_hash FROM app_session WHERE user_id = ?',
        [userId],
      ).length
      db.prepare('DELETE FROM app_session WHERE user_id = ?').run(userId)
      return before
    },

    deleteExpiredSessions(nowIso) {
      const before = queryAll<{ token_hash: string }>(
        db,
        'SELECT token_hash FROM app_session WHERE expires_at <= ?',
        [nowIso],
      ).length
      db.prepare('DELETE FROM app_session WHERE expires_at <= ?').run(nowIso)
      return before
    },
  }
}
