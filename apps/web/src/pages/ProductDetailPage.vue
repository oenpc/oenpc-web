<script setup lang="ts">
import { useSite } from '../site-context'

const site = useSite()
const product = site.product
</script>

<template>
  <article v-if="product" class="product-detail">
    <h1>{{ product.name[site.locale] }}</h1>
    <p class="summary">{{ product.summary[site.locale] }}</p>

    <section v-if="product.specs.length > 0" class="specs">
      <h2>{{ site.messages.specs }}</h2>
      <dl>
        <template v-for="(spec, index) in product.specs" :key="index">
          <dt>{{ spec.key[site.locale] }}</dt>
          <dd>{{ spec.value[site.locale] }}</dd>
        </template>
      </dl>
    </section>

    <!--
      第三方平台链接：
      · rel="noopener noreferrer" —— 缺 noreferrer 会把来源 URL 交给第三方，
        而来源 URL 里可能含内部标识；缺 noopener 则对方可通过 window.opener 改写本页。
      · 这些链接**都在同一个站点内渲染**，所以它是"出站链接白名单"的天然收敛点。
    -->
    <ul v-if="product.channels.length > 0" class="channels">
      <li v-for="channel in product.channels" :key="channel.id">
        <a :href="channel.url" target="_blank" rel="noopener noreferrer">
          {{ channel.label?.[site.locale] ?? site.messages.buyNow }}
        </a>
      </li>
    </ul>
  </article>
</template>
