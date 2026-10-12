<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from './api'
import { setToken } from './session'

const route = useRoute()
const router = useRouter()

/* 登录页不显示导航 —— 那里还没有会话，导航栏只会让人误以为已经登录了 */
const showNav = computed(() => route.meta.public !== true)
const currentUser = computed(() => (route.meta.public === true ? '' : ''))

async function logout(): Promise<void> {
  try {
    await api.post('/api/auth/logout', {})
  } catch {
    /* 服务端可能已经没这个会话了（过期/重启）—— 本地清掉就是"登出成功" */
  }
  setToken(null)
  await router.push({ name: 'login' })
}
</script>

<template>
  <div class="shell">
    <header v-if="showNav" class="topbar">
      <span class="brand">OENPC-WEB 后台</span>
      <nav class="nav">
        <RouterLink :to="{ name: 'products' }">产品</RouterLink>
      </nav>
      <span class="spacer" />
      <span v-if="currentUser" class="who">{{ currentUser }}</span>
      <button type="button" class="btn btn-ghost" @click="logout">退出</button>
    </header>

    <main class="content">
      <RouterView />
    </main>
  </div>
</template>
