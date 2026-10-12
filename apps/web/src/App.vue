<script setup lang="ts">
import { SUPPORTED_LOCALES, type LocaleCode } from '@oenpc-web/shared'
import { HREFLANG_TAGS } from './seo/urls'
import { useSite } from './site-context'

const site = useSite()

/*
 * 当前页面在各语种下的 URL。缺失的语种回退到该语种首页 ——
 * 不能指向"这个页面在那种语言下不存在"的地址，否则会产生软 404，
 * 而软 404 会被搜索引擎记为低质量页面。
 */
function pathFor(locale: LocaleCode): string {
  return site.paths[locale] ?? `/${locale}/`
}
</script>

<template>
  <header class="site-header">
    <a class="brand" :href="`/${site.locale}/`">{{ site.messages.siteName }}</a>

    <nav class="primary">
      <a :href="`/${site.locale}/`">{{ site.messages.navHome }}</a>
      <a :href="`/${site.locale}/products`">{{ site.messages.navProducts }}</a>
    </nav>

    <!--
      语言切换用普通 <a>，不走前端路由。
      静态站点上这只是一次廉价的整页加载，却换来两个好处：
      不引入客户端语言状态（少一处水合不一致的来源），且每个语种都有独立 URL。
    -->
    <nav class="locales">
      <a
        v-for="locale in SUPPORTED_LOCALES"
        :key="locale"
        :href="pathFor(locale)"
        :hreflang="HREFLANG_TAGS[locale]"
        :class="['locale-link', { active: locale === site.locale }]"
      >{{ locale }}</a>
    </nav>
  </header>

  <main class="site-main">
    <RouterView />
  </main>

  <footer class="site-footer">{{ site.messages.siteName }}</footer>
</template>
