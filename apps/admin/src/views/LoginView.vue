<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMessage, type FormInst, type FormRules } from 'naive-ui'
import type { LoginResult } from '@oenpc-web/shared'
import { ApiError, api } from '../api'
import { setAdminIdentity } from '../admin-preferences'
import { setToken } from '../session'

const router = useRouter()
const route = useRoute()
const message = useMessage()

const formRef = ref<FormInst | null>(null)
const formValue = reactive({ username: '', password: '' })
const busy = ref(false)
const error = ref('')
/* 限流用 warning 而不是 error：它和"用户名/口令不正确"是两类问题，视觉上也该分开 */
const errorType = ref<'error' | 'warning'>('error')

const rules: FormRules = {
  username: [{ required: true, message: '请填写用户名', trigger: ['input', 'blur'] }],
  password: [{ required: true, message: '请填写口令', trigger: ['input', 'blur'] }],
}

/*
 * 错误码 → 中文文案。**这是"后端只返回错误码"的落点**：
 * 后端不知道用户界面用哪种语言，文案必须在前端组装。
 * 若后端直接返回中文，将来加英文后台时这些提示就全部无法复用。
 *
 * 且**不能显示 error.message** —— 后端返回的是 `RATE_LIMITED` 这类码，
 * 直接抛给用户看到的是一串大写英文，等于没给信息。
 */
function messageFor(thrown: unknown): { text: string; type: 'error' | 'warning' } {
  if (!(thrown instanceof ApiError)) {
    return { text: '网络异常，请稍后重试', type: 'error' }
  }

  switch (thrown.code) {
    case 'RATE_LIMITED': {
      const seconds = thrown.meta?.retryAfterSeconds
      const wait = typeof seconds === 'number' ? `${seconds} 秒` : '一会儿'
      /*
       * ★ 必须点明"这不是口令错误"。
       * 限流是按**来源 IP**计的：用户看到"登录失败"就去改口令重试，
       * 而每一次重试都会把锁定期重新推后 —— 于是他会一直失败，越试越久。
       * 只说"请稍后再试"不足以打断这个循环，必须明确排除"口令错了"这个猜测。
       */
      return {
        text: `尝试次数过多，请等 ${wait}后再试。这不是口令错误 —— 现在改口令重试只会不断刷新锁定期，请先等待。`,
        type: 'warning',
      }
    }
    case 'UNAUTHORIZED':
      /* 不区分"用户名不存在"与"口令错误" —— 后端就是故意不告诉我们的 */
      return { text: '用户名或口令不正确', type: 'error' }
    case 'BAD_REQUEST':
      return { text: '请填写用户名与口令', type: 'error' }
    default:
      return { text: `登录失败（${thrown.code}）`, type: 'error' }
  }
}

async function submit(): Promise<void> {
  /*
   * 同步置位再 await。回车会同时走"keyup.enter"与浏览器对 <form> 的隐式提交，
   * 若在这里不先占住 busy，两条路径会各发一次登录请求 —— 对已经限流的接口
   * 来说这是最糟的行为（自己把自己的锁定期推后）。
   */
  if (busy.value) return
  busy.value = true
  error.value = ''

  try {
    /* 校验失败的文案由 n-form-item 就地显示，这里只负责不发请求 */
    await formRef.value?.validate()
  } catch {
    busy.value = false
    return
  }

  try {
    const result = await api.post<LoginResult>('/api/auth/login', {
      username: formValue.username,
      password: formValue.password,
    })
    setToken(result.token)
    /*
     * 记下"当前是谁"给顶部栏用。只存展示字符串、**不存整个 user 对象**：
     * 权限判断要在服务端做（前端守卫不构成安全边界），存一份本地权限副本
     * 只会让人误以为前端也在鉴权。展示名取 displayName，回落到 username，
     * 因为 displayName 允许为空。
     */
    setAdminIdentity(result.user.displayName || result.user.username)
    message.success('登录成功')

    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/products'
    await router.push(redirect)
  } catch (thrown) {
    const mapped = messageFor(thrown)
    error.value = mapped.text
    errorType.value = mapped.type
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="card" style="max-width: 420px; margin: 60px auto">
    <h1>登录后台</h1>

    <n-alert v-if="error" :type="errorType" style="margin-bottom: 14px" :show-icon="true">
      {{ error }}
    </n-alert>

    <!--
      @submit.prevent 兜住浏览器对 <form> 的隐式提交（在输入框里按回车），
      它和输入框上的 keyup.enter 是同一个入口，重复触发由 submit() 里的 busy 挡掉。
    -->
    <n-form
      ref="formRef"
      :model="formValue"
      :rules="rules"
      label-placement="top"
      @submit.prevent="submit"
    >
      <n-form-item label="用户名" path="username">
        <n-input
          v-model:value="formValue.username"
          placeholder="用户名"
          autocomplete="username"
          autofocus
          @keyup.enter="submit"
        />
      </n-form-item>

      <n-form-item label="口令" path="password">
        <n-input
          v-model:value="formValue.password"
          type="password"
          show-password-on="click"
          placeholder="口令"
          autocomplete="current-password"
          @keyup.enter="submit"
        />
      </n-form-item>

      <n-button
        type="primary"
        attr-type="button"
        block
        :loading="busy"
        :disabled="busy"
        @click="submit"
      >
        登录
      </n-button>
    </n-form>
  </div>
</template>
