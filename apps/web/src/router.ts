/**
 * 路由（`X` 层 —— 客户端基础设施）。
 *
 * ## 历史模式由调用方注入
 *
 * SSR 用 `createMemoryHistory()`，浏览器用 `createWebHistory()`。
 * 同一个路由表服务两端 —— 这是"SSR 与客户端路由必须一致"的结构性保证：
 * 两边各写一份路由表，迟早会漂移，而漂移的症状是"直接访问某个 URL 能打开、
 * 从站内点进去却 404"（或反之）。
 */

import { createRouter, type RouteRecordRaw, type Router, type RouterHistory } from 'vue-router'
import { PUBLIC_DEFAULT_LOCALE } from '@oenpc-web/shared'
import HomePage from './pages/HomePage.vue'
import ProductListPage from './pages/ProductListPage.vue'
import ProductDetailPage from './pages/ProductDetailPage.vue'
import NotFoundPage from './pages/NotFoundPage.vue'

/**
 * URL 结构（**决策 2**）：路径前缀 `/<locale>/...`。
 *
 * 选它而不是子域名（`en.example.com`）的理由：
 *   · 一份 TLS 证书、一套 nginx 配置，运维面更小；
 *   · 域名权重集中在一个域上，新站起步阶段这点很重要；
 *   · 本地预览与预渲染都只需一个静态目录。
 * 代价是 `/` 需要一次跳转到默认语种。
 */
export const routes: RouteRecordRaw[] = [
  { path: '/:locale/', name: 'home', component: HomePage },
  { path: '/:locale/products', name: 'product-list', component: ProductListPage },
  { path: '/:locale/products/:slug', name: 'product-detail', component: ProductDetailPage },
  { path: '/:pathMatch(.*)*', name: 'not-found', component: NotFoundPage },
]

export function createAppRouter(history: RouterHistory): Router {
  return createRouter({
    history,
    routes,
    /* 精确匹配：`/en` 与 `/en/` 是不同 URL，不做自动补斜杠 —— 避免产生两个可索引地址 */
    strict: true,
  })
}

/** 默认语种的首页路径 —— `/` 会跳到这里。 */
export const DEFAULT_HOME_PATH = `/${PUBLIC_DEFAULT_LOCALE}/`
