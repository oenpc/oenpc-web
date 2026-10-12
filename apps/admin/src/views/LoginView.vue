<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { LoginResult } from '@oenpc-web/shared'
import { ApiError, api } from '../api'
import { setToken } from '../session'

const router = useRouter()
const route = useRoute()

const username = ref('')
const password = ref('')
const busy = ref(false)
const error = ref('')

/*
 * 错误码 → 中文文案。**这是"后端只返回错误码"的落点**：
 * 后端不知道用户界面用哪种语言，文案必须在前端组装。
 * 若后端直接返回中文，将来加英文后台时这些提示就全部无法复用。
 */
function messageFor(thrown: unknown): string {
  if (!(thrown instanceof ApiError)) return '网络异常，请稍后重试'

  switch (thrown.code) {
    case 'RATE_LIMITED': {
      const seconds = thrown.meta?.retryAfterSeconds
      return typeof seconds === 'number'
        ? `尝试过于频繁，请 ${seconds} 秒后再试`
        : '尝试过于频繁，请稍后再试'
    }
    case 'UNAUTHORIZED':
      /* 不区分"用户名不存在"与"口令错误" —— 后端就是故意不告诉我们的 */
      return '用户名或口令不正确'
    case 'BAD_REQUEST':
      return '请填写用户名与口令'
    default:
      return `登录失败（${thrown.code}）`
  }
}

async function submit(): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = ''

  try {
    const result = await api.post<LoginResult>('/api/auth/login', {
      username: username.value,
      password: password.value,
    })
    setToken(result.token)

    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/products'
    await router.push(redirect)
  } catch (thrown) {
    error.value = messageFor(thrown)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="card" style="max-width: 380px; margin: 60px auto">
    <h1>登录后台</h1>

    <p v-if="error" class="alert alert-error">{{ error }}</p>

    <form @submit.prevent="submit">
      <div class="field">
        <label for="username">用户名</label>
        <input id="username" v-model="username" type="text" autocomplete="username" autofocus />
      </div>

      <div class="field">
        <label for="password">口令</label>
        <input id="password" v-model="password" type="password" autocomplete="current-password" />
      </div>

      <button class="btn" type="submit" :disabled="busy || username === '' || password === ''">
        {{ busy ? '登录中…' : '登录' }}
      </button>
    </form>
  </div>
</template>
