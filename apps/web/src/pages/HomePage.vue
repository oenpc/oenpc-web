<script setup lang="ts">
import { useSite } from '../site-context'

const site = useSite()
</script>

<template>
  <section class="hero">
    <h1>{{ site.messages.siteName }}</h1>
    <a class="cta" :href="`/${site.locale}/products`">{{ site.messages.navProducts }}</a>
  </section>
</template>
