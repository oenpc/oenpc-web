/**
 * 手写迁移 —— 版本有序、可重复执行。
 *
 * ## 为什么手写而不是引入迁移框架
 *
 * 迁移是**不可逆**操作，显式优于自动。而且本项目要保留换 PostgreSQL 的能力，
 * 框架生成的 SQL 往往带方言假设，反而更难移植。
 *
 * ## 两个决定了表结构的设计取舍
 *
 * ### 1. 主键是 TEXT（UUID），不是 `INTEGER PRIMARY KEY AUTOINCREMENT`
 *
 * 三个理由，缺一不可：
 *   · `AUTOINCREMENT` 是 **SQLite 专有语法**（PG 用 `GENERATED ... AS IDENTITY`），
 *     用它就违背「预留 PG」，也会被 `portable-sql` 判失败；
 *   · 自增整数会**泄漏业务量**：前台 URL 里出现 `/products/17`，任何人都能枚举；
 *   · 导入导出（F8.4）时整数 id 会冲突，需要额外的 id 重映射层。
 *
 * ### 2. 多语文本走**翻译表**，不是 `name_zh` / `name_en` 两列
 *
 * 这是功能清单 F5.4（必须支持 ≥3 语种）在建表层面的落地。
 * 加第三、第四语种时，翻译表只是多几行；两列方案则要改表结构 + 迁移全部既有数据。
 *
 * **代价要说清楚**：翻译表让「取某语种的产品名」必须 JOIN，
 * 比两列方案多一次连接。这个代价换来的是语种维度的可扩展性，值得。
 *
 * ### 3. 哪些字段进翻译表，哪些进 JSON 列
 *
 * 判据是**是否需要被检索/排序**：
 *   · `name` / `slug` 要被搜索与生成 URL → 翻译表 + 索引；
 *   · `specs`（规格参数）只随产品整体读取，从不单独检索 → JSON 列足够，
 *     避免为它建一张键值表而带来 N 倍行数。
 *
 * 这个判据不是随口定的：把可检索字段塞进 JSON 列，是"搜索功能突然变慢"的常见根因。
 */

import type { DatabaseSync } from 'node:sqlite'
import { nowIsoUtc } from './dialect.js'

export interface Migration {
  id: string
  /** 这条迁移为什么存在 —— 一句话。读起来像天书的迁移是维护性最大的敌人。 */
  note: string
  statements: string[]
}

export const MIGRATIONS: readonly Migration[] = [
  {
    id: '0001_init_product',
    note: '产品域初始结构：产品 / 分类 + 各自翻译表 + 规格 + 图集 + 购买渠道 + 媒体',
    statements: [
      /*
       * 媒体资源。引用计数与删除保护（功能清单 F10.4）不在这里实现 ——
       * 它需要在删除时统计引用，属于 S 层逻辑；这里只保证 **不允许悬空引用**：
       * product.cover_media_id 与 product_media.media_id 都带外键。
       */
      `CREATE TABLE IF NOT EXISTS media_asset (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        mime TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        width INTEGER,
        height INTEGER,
        created_at TEXT NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS product_category (
        id TEXT PRIMARY KEY,
        parent_id TEXT REFERENCES product_category(id) ON DELETE CASCADE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,

      /*
       * 翻译表：主键是 (owner_id, locale)，天然保证"同一产品同一语种只有一条"。
       * slug 的唯一索引是**按语种**唯一的 —— 不同语种允许相同的 slug，
       * 因为它们位于不同的 URL 前缀下（/en/products/x 与 /es/products/x）。
       */
      `CREATE TABLE IF NOT EXISTS product_category_translation (
        category_id TEXT NOT NULL REFERENCES product_category(id) ON DELETE CASCADE,
        locale TEXT NOT NULL,
        slug TEXT NOT NULL,
        name TEXT NOT NULL,
        PRIMARY KEY (category_id, locale)
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_category_translation_slug
        ON product_category_translation (locale, slug)`,

      `CREATE TABLE IF NOT EXISTS product (
        id TEXT PRIMARY KEY,
        category_id TEXT REFERENCES product_category(id) ON DELETE SET NULL,
        cover_media_id TEXT REFERENCES media_asset(id) ON DELETE SET NULL,
        published INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      /* 前台最常见的查询是"某分类下已上架、按顺序"，所以索引带上这三列。 */
      `CREATE INDEX IF NOT EXISTS idx_product_browse
        ON product (published, category_id, sort_order)`,

      `CREATE TABLE IF NOT EXISTS product_translation (
        product_id TEXT NOT NULL REFERENCES product(id) ON DELETE CASCADE,
        locale TEXT NOT NULL,
        slug TEXT NOT NULL,
        name TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (product_id, locale)
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_product_translation_slug
        ON product_translation (locale, slug)`,
      /* 产品搜索（F2.4）按名称匹配，按语种过滤。 */
      `CREATE INDEX IF NOT EXISTS idx_product_translation_name
        ON product_translation (locale, name)`,

      /*
       * 规格参数：`key` / `value` 都是 LocalizedText，序列化成 JSON 存 TEXT。
       * 依据见文件头第 3 条 —— 它们不需要被检索。
       */
      `CREATE TABLE IF NOT EXISTS product_spec (
        product_id TEXT NOT NULL REFERENCES product(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        key_json TEXT NOT NULL,
        value_json TEXT NOT NULL,
        PRIMARY KEY (product_id, position)
      )`,

      `CREATE TABLE IF NOT EXISTS product_media (
        product_id TEXT NOT NULL REFERENCES product(id) ON DELETE CASCADE,
        media_id TEXT NOT NULL REFERENCES media_asset(id) ON DELETE RESTRICT,
        position INTEGER NOT NULL,
        PRIMARY KEY (product_id, media_id)
      )`,

      /*
       * 购买渠道。platform 存枚举码（契约包 PURCHASE_PLATFORMS），不是自由文本 ——
       * 自由文本会让前台图标缺失、统计碎成几十个键（功能清单 F3.2）。
       */
      `CREATE TABLE IF NOT EXISTS purchase_channel (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES product(id) ON DELETE CASCADE,
        platform TEXT NOT NULL,
        url TEXT NOT NULL,
        label_json TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE INDEX IF NOT EXISTS idx_purchase_channel_product
        ON purchase_channel (product_id, sort_order)`,
    ],
  },
]

export interface MigrationResult {
  applied: string[]
  skipped: number
}

/**
 * 执行未应用的迁移。
 *
 * **每条迁移单独一个事务**：失败即回滚该条，不会留下半套表结构。
 * 注意 DDL 在 SQLite 与 PostgreSQL 里都支持事务，所以这个做法两边都成立。
 */
export function migrate(db: DatabaseSync): MigrationResult {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migration (
    id TEXT PRIMARY KEY,
    note TEXT NOT NULL DEFAULT '',
    applied_at TEXT NOT NULL
  )`)

  const rows = db.prepare('SELECT id FROM schema_migration').all() as Array<{ id: string }>
  const alreadyApplied = new Set(rows.map((row) => row.id))
  const applied: string[] = []

  for (const migration of MIGRATIONS) {
    if (alreadyApplied.has(migration.id)) continue

    /*
     * 占位符统一写 `?`（node:sqlite 风格）；PG 实现负责翻译成 `$n`。
     * 理由与限制见 db/dialect.ts 的文件头。
     */
    db.exec('BEGIN')
    try {
      for (const statement of migration.statements) db.exec(statement)
      db
        .prepare('INSERT INTO schema_migration (id, note, applied_at) VALUES (?, ?, ?)')
        .run(migration.id, migration.note, nowIsoUtc())
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw new Error(`迁移 ${migration.id} 失败，已回滚：${String(error)}`)
    }
    applied.push(migration.id)
  }

  return { applied, skipped: MIGRATIONS.length - applied.length }
}
