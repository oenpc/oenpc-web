/**
 * 应用工厂（`E` 层）—— **SSR 与客户端共用同一个 createApp**。
 *
 * 两端复用一个工厂是预渲染能成立的关键：如果客户端与 SSR 各建一套 app，
 * 组件树、provide 的内容、路由表都会漂移，而漂移的症状是
 * **水合失败**（hydration mismatch）—— 页面看起来正常，交互却失效。
 */

import { createSSRApp, type App as VueApp } from 'vue'
import type { Router, RouterHistory } from 'vue-router'
import App from './App.vue'
import { createAppRouter } from './router'
import { SITE_CONTEXT, type SiteContext } from './site-context'

export interface CreatedApp {
  app: VueApp
  router: Router
}

export function createApp(history: RouterHistory, context: SiteContext): CreatedApp {
  const app = createSSRApp(App)
  const router = createAppRouter(history)

  app.use(router)
  app.provide(SITE_CONTEXT, context)

  return { app, router }
}
