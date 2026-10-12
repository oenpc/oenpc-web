/**
 * 客户端入口 —— 在预渲染产出的 HTML 上做**水合**，不是重新渲染。
 *
 * 硬约束 `runtime-config`：站点地址来自**运行时注入**（构建期写进 HTML 的
 * `window.__APP_DATA__`），**不允许**用 `import.meta.env` 在构建期写死 ——
 * 否则同一份产物无法在测试/生产复用。
 *
 * ## 为什么是 async 函数而不是顶层 await
 *
 * Vite 默认构建目标（es2020）**不支持顶层 await**，写了会直接构建失败：
 * `ERROR: Top-level await is not available in the configured target environment`。
 * 两个解法 —— 提高 `build.target` 到 esnext，或不用顶层 await。
 * 这里选后者：为了一个语法糖把整个站点的浏览器兼容性门槛抬到 ES2022 不划算，
 * 而展示站的访客分布很杂（新兴市场的旧机型不少）。
 */

import { createWebHistory } from 'vue-router'
import { createApp } from './app'
import { messagesFor } from './i18n/messages'
import type { SitePayload } from './site-context'

declare global {
  interface Window {
    /** 构建期注入的站点数据（见 `scripts/prerender.mjs`）。 */
    __APP_DATA__?: SitePayload
  }
}

async function bootstrap(): Promise<void> {
  const payload = window.__APP_DATA__

  if (!payload) {
    /*
     * 明确地失败，而不是"用默认值凑合渲染"。
     * 缺这份数据说明 HTML 不是预渲染产出的（例如误把 SSR 模板直接发布了），
     * 此时页面看起来能打开但没有内容 —— 静默降级会让这个问题一路带到线上。
     */
    throw new Error('缺少 window.__APP_DATA__ —— 该 HTML 不是由构建期预渲染产出的')
  }

  const { app, router } = createApp(createWebHistory(), {
    ...payload,
    messages: messagesFor(payload.locale),
  })

  await router.isReady()
  app.mount('#app')
}

bootstrap().catch((error: unknown) => {
  /*
   * 水合失败必须**可见**。若只是静默 catch，症状是"页面能看但按钮全都没反应"，
   * 而那看起来像样式或交互问题，排查方向完全错。
   */
  console.error('[oenpc-web] 客户端启动失败：', error)
})
