<script setup lang="ts">
import { useSite } from '../site-context'

const site = useSite()
</script>

<template>
  <section class="not-found">
    <h1>{{ site.messages.notFound }}</h1>
    <a :href="`/${site.locale}/`">{{ site.messages.navHome }}</a>
  </section>
</template>
