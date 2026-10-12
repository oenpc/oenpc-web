/**
 * 产品仓储的**端口**（接口）—— 与具体数据库驱动无关。
 *
 * ## 为什么必须单独有这一层
 *
 * 需求里写了「预留 PostgreSQL 对接」。骨架阶段只做到了一半：
 * `db/dialect.ts` 把 SQL 方言收口了，但仓储函数签名直接吃 `DatabaseSync` ——
 * 也就是说，换 PG 时方言不用改，**但每个仓储的签名与装配点都要动**。
 *
 * 把端口抽出来之后，「可替换」才成为一条**结构上成立**的性质：
 *   服务层依赖 `ProductRepository`（这里），不依赖 `DatabaseSync`；
 *   换驱动 = 新增一个 `createPostgresProductRepository(db)` 并在 `index.ts` 改一行装配。
 *
 * ## 为什么现在做（而不是等有 12 个域时）
 *
 * 现在只有 1 个域、3 个方法。抽接口是改 3 个签名 + 1 处装配；
 * 等 12 个域铺开再抽，是改几十个签名 + 所有装配点 + 所有测试。
 * **这是整个项目里唯一一个"成本随时间线性增长"的任务。**
 *
 * ## 返回类型全部来自契约包
 *
 * 端口里不出现任何数据库类型（`DatabaseSync` / `SQLInputValue` / Row 类型）——
 * 一旦出现，这个接口就又绑死在 SQLite 上了。行类型的转换是实现的内部事务
 * （见 `mapper.ts`）。
 */

import type { LocaleCode, Page, Product, ProductListItem, ProductQuery } from '@oenpc-web/shared'

export interface ProductRepository {
  /** 分页查询。`query.publishedOnly` 由调用方（服务层）决定，仓储只忠实执行。 */
  list(query: ProductQuery): Page<ProductListItem>

  /** 取完整外形；返回 `null` 表示不存在 —— **不与"出错"混为同一返回值**。 */
  getById(id: string): Product | null

  /**
   * 某语种下全部已上架产品的 slug。
   *
   * 前台是 SSG，构建期需要枚举出所有产品 URL；`hreflang` 互指则需要对
   * **每个受支持语种**各调一次。
   */
  listPublishedSlugs(locale: LocaleCode): Array<{ id: string; slug: string }>
}
