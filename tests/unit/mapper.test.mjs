/**
 * 行 → DTO 映射的单元测试。
 *
 * 这里测的是**数据库与契约之间的三处阻抗失配**：
 *   · SQLite 的 INTEGER 0/1 → 契约的 boolean
 *   · 库里多行翻译 → 契约的 LocalizedText
 *   · JSON 列损坏时的降级行为
 * 这些都不会在类型检查里暴露 —— 类型上 `number` 与 `boolean` 是不同的，
 * 但真到了运行时，"已下架却没被隐藏"这类 bug 就出在这里。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
/*
 * 注意：这是纯 JS（.mjs），不能写 TS 的 `type` 修饰符，
 * 也不能 import 类型（它们在 dist 里已被擦除，运行时不存在）。
 * 所以下面用普通对象字面量构造行数据。
 */
import { toProduct, toProductListItem } from '../../apps/server/dist/repositories/products/mapper.js'

function productRow(overrides = {}) {
  return {
    id: 'p1',
    category_id: null,
    cover_media_id: null,
    published: 1,
    sort_order: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function translation(locale, name, extra = {}) {
  return {
    product_id: 'p1',
    locale,
    slug: `slug-${locale}`,
    name,
    summary: '',
    description: '',
    ...extra,
  }
}

test('SQLite 的 INTEGER 0/1 转成 boolean', () => {
  assert.equal(toProduct(productRow({ published: 1 }), [], [], [], []).published, true)
  assert.equal(toProduct(productRow({ published: 0 }), [], [], [], []).published, false)
})

test('多行翻译收成一个 LocalizedText，且跳过空值', () => {
  const translations = [
    translation('zh', '钢管'),
    translation('en', 'Steel Pipe'),
    translation('es', ''), // 空值不应产生键
  ]
  const item = toProductListItem(productRow(), translations, [])

  assert.deepEqual(item.name, { zh: '钢管', en: 'Steel Pipe' })
  assert.deepEqual(item.slug, { zh: 'slug-zh', en: 'slug-en', es: 'slug-es' })
})

test('三种语种都要在返回值里 —— hreflang 需要每个语种的 slug', () => {
  const translations = [translation('zh', '钢管'), translation('en', 'Steel Pipe'), translation('es', 'Tubo')]
  const item = toProductListItem(productRow(), translations, [])
  assert.deepEqual(Object.keys(item.slug).sort(), ['en', 'es', 'zh'])
})

test('枚举外的渠道平台被**丢弃**，而不是渲染出一个空按钮', () => {
  const channels = [
    { id: 'c1', product_id: 'p1', platform: 'alibaba', url: 'https://a.example', label_json: null, sort_order: 1 },
    { id: 'c2', product_id: 'p1', platform: 'totally-bogus', url: 'https://b.example', label_json: null, sort_order: 2 },
  ]
  const links = toProductListItem(productRow(), [], channels).channels

  assert.equal(links.length, 1)
  assert.equal(links[0].platform, 'alibaba')
})

test('渠道按 sortOrder 升序（库的返回顺序不保证）', () => {
  const channels = [
    { id: 'c2', product_id: 'p1', platform: 'amazon', url: 'https://b.example', label_json: null, sort_order: 9 },
    { id: 'c1', product_id: 'p1', platform: 'alibaba', url: 'https://a.example', label_json: null, sort_order: 1 },
  ]
  const links = toProductListItem(productRow(), [], channels).channels
  assert.deepEqual(links.map((l) => l.id), ['c1', 'c2'])
})

test('JSON 列损坏时降级为空对象，不让整页 500', () => {
  const specs = [
    { product_id: 'p1', position: 1, key_json: '{"zh":"材质"}', value_json: '{ this is not json' },
  ]
  const product = toProduct(productRow(), [], specs, [], [])

  assert.deepEqual(product.specs[0].key, { zh: '材质' })
  assert.deepEqual(product.specs[0].value, {})
})

test('规格按 position 排序', () => {
  const specs = [
    { product_id: 'p1', position: 5, key_json: '{"zh":"B"}', value_json: '{}' },
    { product_id: 'p1', position: 2, key_json: '{"zh":"A"}', value_json: '{}' },
  ]
  const product = toProduct(productRow(), [], specs, [], [])
  assert.deepEqual(product.specs.map((s) => s.key.zh), ['A', 'B'])
})
