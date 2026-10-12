/**
 * `ProductRepository` 端口的 **SQLite 实现**（PD 域）—— **SQL 只允许出现在这一层与 `db/`**。
 *
 * 约束 `no-sql-in-routes` 守着这条边界：R / C 层出现 SQL 即判失败。
 * 理由不是洁癖，而是「预留 PostgreSQL」：SQL 散落在路由里，换库就要改遍所有路由。
 *
 * ## 三个实现取舍
 *
 * ### 1. 列表页取**全部语种**的翻译，不只是请求的那一个
 *
 * 看起来浪费，但这门生意需要它：前台要为每个产品输出
 * `<link rel="alternate" hreflang="es" href="/es/products/...">`。
 * **hreflang 需要每个语种的 slug** —— 只取请求语种的话，构建期就生成不出互指链接，
 * 而互指关系错了，搜索引擎会把多语页面当成重复内容。
 *
 * ### 2. 用多次查询而不是一次多表 JOIN
 *
 * 一个产品有 N 张图、M 个渠道、K 条规格。把它们全部 JOIN 进主查询会让结果集
 * 变成 N×M×K 行，再在应用层去重 —— 数据量小时看不出问题，产品一多就会
 * 让列表接口的返回时间随图片数增长。所以：主查询拿产品，再用一次 `IN` 批量取关联。
 *
 * ### 3. LIKE 的用户输入必须转义
 *
 * 不转义的话，访客搜索一个 `%` 就会匹配全部产品（等于把搜索变成全表扫描）。
 *
 * ## 加 PG 实现时要注意什么
 *
 * 本文件里的 SQL 本身是可移植的（没有 `INSERT OR REPLACE` / `AUTOINCREMENT` /
 * `datetime('now')` —— 由 `portable-sql` 守着）。**但有两处方言差异检查器检测不到**：
 *   · 参数占位符 `?`（SQLite）→ `$1`（PG）
 *   · `LIKE` 在 SQLite 对 ASCII 大小写不敏感，PG 的 `LIKE` 敏感（需换 `ILIKE`）
 * 以及一处行为差异：`COUNT(*)` 在 SQLite 返回 number，PG 的 `bigint` 需要转换。
 */

import { randomUUID } from 'node:crypto'
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import type {
  LocaleCode,
  Page,
  Product,
  ProductInput,
  ProductListItem,
  ProductQuery,
} from '@oenpc-web/shared'
import { toJsonColumn } from '../../db/dialect.js'
import type { ProductRepository } from './port.js'
import {
  toAdminSummary,
  toProduct,
  toProductListItem,
  type ProductRow,
  type ProductSpecRow,
  type ProductTranslationRow,
  type PurchaseChannelRow,
} from './mapper.js'

/** 单页上限 —— 防止 `pageSize` 被放大成一次全表扫描。 */
const MAX_PAGE_SIZE = 60
const DEFAULT_PAGE_SIZE = 24

/*
 * `node:sqlite` 把结果行标成 `Record<string, SQLOutputValue>`，它与我们的行类型
 * 「结构上不重叠」，所以直接 `as` 会被 TS 拒绝。把 double-cast 收口在这两个函数里，
 * 而不是散落到十几处调用点 —— 断言越集中，将来换驱动时要改的地方越少。
 */
function queryAll<T>(db: DatabaseSync, sql: string, params: SQLInputValue[] = []): T[] {
  return db.prepare(sql).all(...params) as unknown as T[]
}

function queryOne<T>(db: DatabaseSync, sql: string, params: SQLInputValue[] = []): T | undefined {
  return db.prepare(sql).get(...params) as unknown as T | undefined
}

/**
 * 把用户输入转成 LIKE 模式。
 *
 * `%` `_` `\` 都是 LIKE 的通配/转义字符，必须转义，
 * 否则访客搜索一个 `%` 就等于"匹配全部"。
 */
function likePattern(raw: string): string {
  return `%${raw.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ')
}

function normalizePaging(query: ProductQuery): { page: number; pageSize: number; offset: number } {
  const page = Math.max(1, Math.trunc(query.page ?? 1))
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(query.pageSize ?? DEFAULT_PAGE_SIZE)))
  return { page, pageSize, offset: (page - 1) * pageSize }
}

/** 组装列表查询的 WHERE 子句与参数。 */
function buildFilters(query: ProductQuery): { where: string; params: SQLInputValue[] } {
  const conditions: string[] = []
  const params: SQLInputValue[] = []

  if (query.publishedOnly) conditions.push('p.published = 1')

  if (query.categoryId) {
    conditions.push('p.category_id = ?')
    params.push(query.categoryId)
  }

  const keyword = query.keyword?.trim()
  if (keyword) {
    /*
     * 关键词按**请求语种**匹配名称与 slug。
     *
     * ⚠ 方言差异（检查器检测不到，靠评审）：`LIKE` 在 SQLite 对 ASCII 大小写不敏感，
     *   而 PostgreSQL 的 `LIKE` 是**大小写敏感**的，PG 实现需要换成 `ILIKE`。
     */
    conditions.push(
      `EXISTS (
        SELECT 1 FROM product_translation t
        WHERE t.product_id = p.id
          AND t.locale = ?
          AND (t.name LIKE ? ESCAPE '\\' OR t.slug LIKE ? ESCAPE '\\')
      )`,
    )
    const pattern = likePattern(keyword)
    params.push(query.locale, pattern, pattern)
  }

  return {
    where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  }
}

function fetchTranslations(
  db: DatabaseSync,
  productIds: readonly string[],
): Map<string, ProductTranslationRow[]> {
  const grouped = new Map<string, ProductTranslationRow[]>()
  if (productIds.length === 0) return grouped

  const rows = queryAll<ProductTranslationRow>(
    db,
    `SELECT product_id, locale, slug, name, summary, description
     FROM product_translation
     WHERE product_id IN (${placeholders(productIds.length)})`,
    [...productIds],
  )

  for (const row of rows) {
    const list = grouped.get(row.product_id)
    if (list) list.push(row)
    else grouped.set(row.product_id, [row])
  }
  return grouped
}

function fetchChannels(
  db: DatabaseSync,
  productIds: readonly string[],
): Map<string, PurchaseChannelRow[]> {
  const grouped = new Map<string, PurchaseChannelRow[]>()
  if (productIds.length === 0) return grouped

  const rows = queryAll<PurchaseChannelRow>(
    db,
    `SELECT id, product_id, platform, url, label_json, sort_order
     FROM purchase_channel
     WHERE product_id IN (${placeholders(productIds.length)})
     ORDER BY sort_order ASC`,
    [...productIds],
  )

  for (const row of rows) {
    const list = grouped.get(row.product_id)
    if (list) list.push(row)
    else grouped.set(row.product_id, [row])
  }
  return grouped
}

/**
 * 用给定的 SQLite 连接创建产品仓储。
 *
 * 装配点只有一个（`apps/server/src/index.ts`）—— 这是端口存在的实际收益：
 * 换驱动时改的是那一行，不是所有调用方。
 */
export function createSqliteProductRepository(db: DatabaseSync): ProductRepository {
  return {
    list(query: ProductQuery): Page<ProductListItem> {
      const { page, pageSize, offset } = normalizePaging(query)
      const { where, params } = buildFilters(query)

      const totalRow = queryOne<{ total: number }>(
        db,
        `SELECT COUNT(*) AS total FROM product p ${where}`,
        params,
      )
      const total = totalRow?.total ?? 0

      const rows = queryAll<ProductRow>(
        db,
        `SELECT p.id, p.category_id, p.cover_media_id, p.published, p.sort_order,
                p.created_at, p.updated_at
         FROM product p
         ${where}
         ORDER BY p.sort_order ASC, p.created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, pageSize, offset],
      )

      const ids = rows.map((row) => row.id)
      const translations = fetchTranslations(db, ids)
      const channels = fetchChannels(db, ids)

      return {
        items: rows.map((row) =>
          toProductListItem(row, translations.get(row.id) ?? [], channels.get(row.id) ?? []),
        ),
        total,
        page,
        pageSize,
      }
    },

    getById(id: string): Product | null {
      const row = queryOne<ProductRow>(
        db,
        `SELECT id, category_id, cover_media_id, published, sort_order, created_at, updated_at
         FROM product WHERE id = ?`,
        [id],
      )

      if (!row) return null

      const translations = fetchTranslations(db, [id]).get(id) ?? []
      const channels = fetchChannels(db, [id]).get(id) ?? []

      const specs = queryAll<ProductSpecRow>(
        db,
        `SELECT product_id, position, key_json, value_json
         FROM product_spec WHERE product_id = ? ORDER BY position ASC`,
        [id],
      )

      const mediaRows = queryAll<{ media_id: string }>(
        db,
        'SELECT media_id FROM product_media WHERE product_id = ? ORDER BY position ASC',
        [id],
      )

      return toProduct(
        row,
        translations,
        specs,
        mediaRows.map((media) => media.media_id),
        channels,
      )
    },

    listPublishedSlugs(locale: LocaleCode): Array<{ id: string; slug: string }> {
      return queryAll<{ id: string; slug: string }>(
        db,
        `SELECT p.id AS id, t.slug AS slug
         FROM product p
         JOIN product_translation t ON t.product_id = p.id AND t.locale = ?
         WHERE p.published = 1
         ORDER BY p.sort_order ASC`,
        [locale],
      )
    },

    listForAdmin(page, pageSize) {
      const safePage = Math.max(1, Math.trunc(page))
      const safeSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(pageSize)))
      const offset = (safePage - 1) * safeSize

      const totalRow = queryOne<{ total: number }>(db, 'SELECT COUNT(*) AS total FROM product')
      const rows = queryAll<ProductAdminRow>(
        db,
        `SELECT id, category_id, cover_media_id, published, sort_order, updated_at
         FROM product
         ORDER BY updated_at DESC, id DESC
         LIMIT ? OFFSET ?`,
        [safeSize, offset],
      )

      const ids = rows.map((row) => row.id)
      const translations = fetchTranslations(db, ids)

      return {
        items: rows.map((row) => toAdminSummary(row, translations.get(row.id) ?? [])),
        total: totalRow?.total ?? 0,
        page: safePage,
        pageSize: safeSize,
      }
    },

    create(input, id, now) {
      db.exec('BEGIN')
      try {
        const conflict = findSlugConflict(db, input, null)
        if (conflict) {
          db.exec('ROLLBACK')
          return { conflict }
        }

        db.prepare(
          `INSERT INTO product (id, category_id, cover_media_id, published, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(id, input.categoryId, input.coverMediaId, input.published ? 1 : 0, input.sortOrder, now, now)

        writeChildren(db, id, input)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }

      const created = this.getById(id)
      if (!created) throw new Error(`创建产品后读不回来：${id}`)
      return created
    },

    update(id, input, now) {
      const existing = queryOne<ProductRow>(db, 'SELECT * FROM product WHERE id = ?', [id])
      if (!existing) return null

      db.exec('BEGIN')
      try {
        const conflict = findSlugConflict(db, input, id)
        if (conflict) {
          db.exec('ROLLBACK')
          return { conflict }
        }

        db.prepare(
          `UPDATE product
           SET category_id = ?, cover_media_id = ?, published = ?, sort_order = ?, updated_at = ?
           WHERE id = ?`,
        ).run(input.categoryId, input.coverMediaId, input.published ? 1 : 0, input.sortOrder, now, id)

        /*
         * 整份替换：先删子行再重建。语义见契约里的 ProductInput 说明 ——
         * "提交什么就是什么"，避免逐字段 PATCH 的 undefined/null 歧义。
         * 全部 DELETE 都在同一事务里，中途失败整体回滚。
         */
        db.prepare('DELETE FROM product_translation WHERE product_id = ?').run(id)
        db.prepare('DELETE FROM product_spec WHERE product_id = ?').run(id)
        db.prepare('DELETE FROM product_media WHERE product_id = ?').run(id)
        db.prepare('DELETE FROM purchase_channel WHERE product_id = ?').run(id)

        writeChildren(db, id, input)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }

      return this.getById(id)
    },

    setPublished(id, published, now) {
      const result = db
        .prepare('UPDATE product SET published = ?, updated_at = ? WHERE id = ?')
        .run(published ? 1 : 0, now, id)
      return Number((result as { changes?: number | bigint }).changes ?? 0) > 0
    },

    remove(id) {
      const result = db.prepare('DELETE FROM product WHERE id = ?').run(id)
      return Number((result as { changes?: number | bigint }).changes ?? 0) > 0
    },
  }
}

/* ───────────────────── 写入辅助（模块私有） ───────────────────── */

interface ProductAdminRow {
  id: string
  category_id: string | null
  cover_media_id: string | null
  published: number
  sort_order: number
  updated_at: string
}

/**
 * 找出与本次提交冲突的 slug；无冲突返回 `null`。
 *
 * **必须与写入处在同一个事务内**（调用方已 BEGIN）。分开做的话，两个并发请求
 * 可以同时通过检查然后都写进去 —— 而按语种唯一的索引会让第二个请求
 * 以一个跟"slug 重复"毫无关系的数据库错误失败，排查方向完全错。
 */
function findSlugConflict(
  db: DatabaseSync,
  input: ProductInput,
  exceptProductId: string | null,
): string | null {
  for (const [locale, translation] of Object.entries(input.translations)) {
    if (!translation) continue
    const row = queryOne<{ product_id: string }>(
      db,
      `SELECT product_id FROM product_translation
       WHERE locale = ? AND slug = ? AND product_id != ?`,
      [locale, translation.slug, exceptProductId ?? ''],
    )
    if (row) {
      return `slug "${translation.slug}" 在语种 ${locale} 下已被产品 ${row.product_id} 占用`
    }
  }
  return null
}

/** 写入产品的全部子行。调用方负责事务边界。 */
function writeChildren(db: DatabaseSync, productId: string, input: ProductInput): void {
  for (const [locale, translation] of Object.entries(input.translations)) {
    if (!translation) continue
    db.prepare(
      `INSERT INTO product_translation (product_id, locale, slug, name, summary, description)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(productId, locale, translation.slug, translation.name, translation.summary, translation.description)
  }

  input.specs.forEach((spec, index) => {
    db.prepare('INSERT INTO product_spec (product_id, position, key_json, value_json) VALUES (?, ?, ?, ?)').run(
      productId,
      index,
      toJsonColumn(spec.key),
      toJsonColumn(spec.value),
    )
  })

  input.mediaIds.forEach((mediaId, index) => {
    db.prepare('INSERT INTO product_media (product_id, media_id, position) VALUES (?, ?, ?)').run(
      productId,
      mediaId,
      index,
    )
  })

  for (const channel of input.channels) {
    db.prepare(
      `INSERT INTO purchase_channel (id, product_id, platform, url, label_json, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      /* 渠道行 id 在这里生成：它没有对外语义，调用方不该操心 */
      randomUUID(),
      productId,
      channel.platform,
      channel.url,
      channel.label ? toJsonColumn(channel.label) : null,
      channel.sortOrder,
    )
  }
}
