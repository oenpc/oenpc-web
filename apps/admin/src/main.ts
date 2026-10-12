import { createApp } from 'vue'
import App from './App.vue'
import { setUnauthorizedHandler } from './api'
import { createAppRouter } from './router'
import './styles.css'

const router = createAppRouter()

/*
 * 令牌在任何一次请求里失效（过期、被停用、服务端重启后换了库）时，
 * 统一跳回登录页。没有这一步，用户会停在页面上反复点、每次都失败，
 * 却不知道"需要重新登录"—— 而报错信息只会说"未授权"。
 */
setUnauthorizedHandler(() => {
  void router.push({ name: 'login' })
})

createApp(App).use(router).mount('#app')
