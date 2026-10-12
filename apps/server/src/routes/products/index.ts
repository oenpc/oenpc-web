/**
 * 产品路由注册（PD 域，`R` 层）。
 *
 * ## URL 前缀与前台语种的关系
 *
 * 这里挂在 `/api/products`，**不带语种** —— 语种走 querystring 的 `locale`。
 * 而前台的**页面** URL 是带语种前缀的（`/en/products/<slug>`）。
 *
 * 这两个不是一回事，别混：
 *   · 页面 URL 的语种前缀是为了**搜索引擎**能分开收录（SEO 要求）；
 *   · API 的 `locale` 是**内容协商**参数，同一个接口服务所有语种。
 *
 * 若把语种塞进 API 路径（`/api/en/products`），缓存键会按语种翻倍，
 * 而接口本身并不因语种而不同 —— 只是返回内容不同。
 */

import type { FastifyInstance } from 'fastify'
import type { ProductRepository } from '../../repositories/products/port.js'
import { createProductHandlers } from './handlers.js'

export function registerProductRoutes(
  app: FastifyInstance,
  deps: { products: ProductRepository },
): void {
  const handlers = createProductHandlers(deps)

  /*
   * 注意路由注册顺序：`/api/products` 与 `/api/products/:id` 是不同路径，
   * Fastify 的 radix 路由树能正确区分，不存在"前者吃掉后者"的问题。
   * （这与 nginx 的 `location` 前缀匹配不同 —— 那里的顺序是真的会吃路由，见索引 §4 陷阱 P-07。）
   */
  app.get('/api/products', handlers.list)
  app.get('/api/products/:id', handlers.detail)
}
