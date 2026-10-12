/*
 * 会话令牌的本地存储。
 *
 * ## 为什么用 localStorage 而不是 Cookie
 *
 * 后端用 `Authorization: Bearer`（见 core/auth-context.ts 的说明）：
 * Bearer 头**不会被浏览器自动携带**，因此天然免疫 CSRF；
 * 而 Cookie 方案需要额外处理 SameSite / Secure / CSRF token 一整套。
 *
 * ## 代价必须说清
 *
 * localStorage 里的令牌可被同源的 JS 读取，所以**一旦出现 XSS，令牌就会被偷走**。
 * 本项目的缓解措施：
 *   · Vue 模板默认转义插值，不拼 innerHTML；
 *   · 媒体上传白名单里**不含 SVG**（SVG 可内嵌脚本，是最常见的 XSS 载体）；
 *   · `/media/:id` 响应带 `X-Content-Type-Options: nosniff`。
 * 这三条不构成绝对防护。要更强的话，应改为 **HttpOnly Cookie + CSRF token**，
 * 那是安全与复杂度的交换，本轮不做。
 */

const TOKEN_KEY = 'oenpc-web.admin.token'

export function getToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY)
  } catch {
    /* 隐私模式下 localStorage 可能直接抛错 —— 当作未登录处理，不要让它崩掉整个应用 */
    return null
  }
}

export function setToken(token: string | null): void {
  try {
    if (token === null) window.localStorage.removeItem(TOKEN_KEY)
    else window.localStorage.setItem(TOKEN_KEY, token)
  } catch {
    /* 存不进去就退化为"仅本次内存有效"，不阻断登录 */
  }
}
