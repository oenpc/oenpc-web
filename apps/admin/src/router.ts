import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { getToken } from './session'
import LoginView from './views/LoginView.vue'
import ProductEditView from './views/ProductEditView.vue'
import ProductListView from './views/ProductListView.vue'

export const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/products' },
  { path: '/login', name: 'login', component: LoginView, meta: { public: true } },
  { path: '/products', name: 'products', component: ProductListView },
  { path: '/products/new', name: 'product-new', component: ProductEditView },
  { path: '/products/:id', name: 'product-edit', component: ProductEditView },
  /* 兜底：未匹配的路径回列表页，而不是留一个空白屏 */
  { path: '/:pathMatch(.*)*', redirect: '/products' },
]

export function createAppRouter() {
  const router = createRouter({
    /*
     * ★ base 必须与 `vite.config.ts` 的 `base` 及 nginx 的 location 三者一致。
     * 前后台都挂在同一个域下，后台在 `/admin/` —— 不一致时路由会以为自己在根路径，
     * 于是刷新任意页面都会变成 404。三者的一致性靠部署说明里的清单保证。
     */
    history: createWebHistory('/admin/'),
    routes,
  })

  /*
   * 前置守卫只做"有没有令牌"这一层判断 —— **它不构成安全边界**。
   * 真正的鉴权在服务端（每个写接口都挂了 `requireAdmin`）。
   * 前端守卫的作用是用户体验：没登录就别让人看到一个必然报错的页面。
   */
  router.beforeEach((to) => {
    if (to.meta.public === true) return true
    if (getToken() === null) return { name: 'login', query: { redirect: to.fullPath } }
    return true
  })

  return router
}
