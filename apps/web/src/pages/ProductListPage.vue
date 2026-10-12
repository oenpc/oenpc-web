<script setup lang="ts">
import type { ProductListItem } from '@oenpc-web/shared'
import { productDetailPath } from '../seo/urls'
import { useSite } from '../site-context'

const site = useSite()

/*
 * 取当前语种的 slug；缺失时回退到 id。
 *
 * 回退到 id 是**不得已的下策**：`/en/products/p-123` 这样的 URL 对搜索引擎
 * 毫无信息量。正常运营下每个产品都应当有各语种的 slug，
 * `products-api` 的回归脚本就在断言列表接口返回全部语种的 slug。
 */
function hrefFor(item: ProductListItem): string {
  return productDetailPath(site.locale, item.slug[site.locale] ?? item.id)
}
</script>

<template>
  <h1>{{ site.messages.productsTitle }}</h1>

  <p v-if="site.products.length === 0" class="empty">{{ site.messages.emptyProducts }}</p>

  <ul v-else class="product-grid">
    <li v-for="item in site.products" :key="item.id" class="product-card">
      <a class="product-name" :href="hrefFor(item)">{{ item.name[site.locale] }}</a>
      <p class="product-summary">{{ item.summary[site.locale] }}</p>
    </li>
  </ul>
</template>
