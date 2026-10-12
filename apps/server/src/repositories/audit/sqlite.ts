/**
 * `AuditRepository` 端口的 **SQLite 实现**（AL 域）。
 *
 * 写日志失败**不应让业务操作失败** —— 但也不能静默吞掉。
 * 这里的取舍是：`append` 抛出的异常由调用方（服务层）决定怎么处理。
 * 服务层的做法是记 error 日志后继续 —— 因为"产品没保存成功"比"审计少一条"更糟。
 *
 * 需要更强的保证时（金融、合规场景），应当把审计写入与业务写入放进**同一个事务**，
 * 让它们一起成功或一起失败。本项目没有到那个强度要求，所以保持简单，
 * 但把这个取舍写在这里，避免后来人以为这是疏忽。
 */

import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import type { AuditAppendInput, AuditEntryRecord, AuditRepository } from './port.js'

interface AuditRow {
  id: string
  actor_id: string | null
  actor_name: string
  action: string
  object_type: string
  object_id: string
  detail_json: string | null
  created_at: string
}

function queryAll<T>(db: DatabaseSync, sql: string, params: SQLInputValue[] = []): T[] {
  return db.prepare(sql).all(...params) as unknown as T[]
}

function parseDetail(raw: string | null): Record<string, unknown> | null {
  if (raw === null || raw === '') return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    /* 详情损坏不该让日志查询整个失败 —— 保留记录本身比保留它的细节更重要 */
    return null
  }
}

function toRecord(row: AuditRow): AuditEntryRecord {
  return {
    id: row.id,
    actorId: row.actor_id,
    actorName: row.actor_name,
    action: row.action,
    objectType: row.object_type,
    objectId: row.object_id,
    detail: parseDetail(row.detail_json),
    createdAt: row.created_at,
  }
}

export function createSqliteAuditRepository(db: DatabaseSync): AuditRepository {
  return {
    append(entry: AuditAppendInput) {
      db.prepare(
        `INSERT INTO audit_log
           (id, actor_id, actor_name, action, object_type, object_id, detail_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        entry.id,
        entry.actorId,
        entry.actorName,
        entry.action,
        entry.objectType ?? '',
        entry.objectId ?? '',
        entry.detail ? JSON.stringify(entry.detail) : null,
        entry.now,
      )
    },

    recent(limit) {
      const rows = queryAll<AuditRow>(
        db,
        `SELECT id, actor_id, actor_name, action, object_type, object_id, detail_json, created_at
         FROM audit_log ORDER BY created_at DESC, id DESC LIMIT ?`,
        [Math.max(1, Math.min(200, Math.trunc(limit)))],
      )
      return rows.map(toRecord)
    },
  }
}
