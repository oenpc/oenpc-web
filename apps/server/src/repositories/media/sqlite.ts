/**
 * `MediaRepository` 端口的 **SQLite 实现**（MD 域）。
 *
 * `countReferences` 把"封面引用"与"图集引用"分别数出来再相加。
 * 分两次数而不是一次 UNION，是因为两张表的结构不同（封面是产品表上的一列，
 * 图集是关联表）—— 用 UNION 会把两种语义压成一个数，将来想区分"只被当封面引用"
 * 与"只被当图集引用"时就没有信息了。
 */

import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import type { CreateMediaInput, MediaAssetRecord, MediaRepository } from './port.js'

interface MediaRow {
  id: string
  filename: string
  mime: string
  byte_size: number
  width: number | null
  height: number | null
  created_at: string
}

function queryOne<T>(db: DatabaseSync, sql: string, params: SQLInputValue[] = []): T | undefined {
  return db.prepare(sql).get(...params) as unknown as T | undefined
}

function queryAll<T>(db: DatabaseSync, sql: string, params: SQLInputValue[] = []): T[] {
  return db.prepare(sql).all(...params) as unknown as T[]
}

function toRecord(row: MediaRow): MediaAssetRecord {
  return {
    id: row.id,
    filename: row.filename,
    mime: row.mime,
    byteSize: row.byte_size,
    width: row.width,
    height: row.height,
    createdAt: row.created_at,
  }
}

export function createSqliteMediaRepository(db: DatabaseSync): MediaRepository {
  return {
    create(input: CreateMediaInput) {
      db.prepare(
        `INSERT INTO media_asset (id, filename, mime, byte_size, width, height, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(input.id, input.filename, input.mime, input.byteSize, input.width, input.height, input.now)

      const created = this.getById(input.id)
      if (!created) throw new Error(`创建媒体记录后读不回来：${input.id}`)
      return created
    },

    getById(id) {
      const row = queryOne<MediaRow>(db, 'SELECT * FROM media_asset WHERE id = ?', [id])
      return row ? toRecord(row) : null
    },

    list(limit, offset) {
      const totalRow = queryOne<{ total: number }>(db, 'SELECT COUNT(*) AS total FROM media_asset')
      const rows = queryAll<MediaRow>(
        db,
        `SELECT * FROM media_asset ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
        [limit, offset],
      )
      return { items: rows.map(toRecord), total: totalRow?.total ?? 0 }
    },

    delete(id) {
      db.prepare('DELETE FROM media_asset WHERE id = ?').run(id)
    },

    countReferences(id) {
      const asCover = queryOne<{ total: number }>(
        db,
        'SELECT COUNT(*) AS total FROM product WHERE cover_media_id = ?',
        [id],
      )
      const asGallery = queryOne<{ total: number }>(
        db,
        'SELECT COUNT(*) AS total FROM product_media WHERE media_id = ?',
        [id],
      )
      return (asCover?.total ?? 0) + (asGallery?.total ?? 0)
    },
  }
}
