<script setup lang="ts">
/*
 * 应用根内层 —— provider 的**下游**，所以这里的子树可以用 useMessage/useDialog。
 * 完整外壳（侧边栏、菜单、主题切换）是批次 3 的活，本轮只放占位外壳。
 */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { LogOutOutline } from '@vicons/ionicons5'
import { api } from './api'
import { getToken, setToken } from './session'
import LoginView from './views/LoginView.vue'

const route = useRoute()
const router = useRouter()

/*
 * 登录态判断。`session.ts` 是纯读写 localStorage 的函数，令牌本身不可响应，
 * 所以这里把 `route.fullPath` 也读一次当依赖：登录成功、主动退出、401 清理
 * 三条路径**都伴随着一次路由跳转**，读路由即可让这个 computed 重新求值。
 * 不把它做成 store：批次 3 的外壳才需要真正的响应式会话状态，
 * 现在多一份可写状态就多一处可能与 localStorage 不一致的地方。
 */
const showLogin = computed(() => {
  void route.fullPath
  return getToken() === null || route.meta.public === true
})

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
  <!-- 未登录只渲染登录页：此时还没有会话，任何导航都会让人误以为已经登录了 -->
  <LoginView v-if="showLogin" />

  <div v-else class="shell">
    <header class="topbar">
      <span class="brand">OENPC-WEB 后台</span>
      <span class="spacer" />
      <n-button quaternary size="small" @click="logout">
        <template #icon>
          <n-icon :component="LogOutOutline" />
        </template>
        退出
      </n-button>
    </header>

    <main class="content">
      <p class="muted">
        已登录。侧边栏、菜单与主题切换属于批次 3 —— 本轮这里只是一个占位外壳。
      </p>
      <RouterView />
    </main>
  </div>
</template>
