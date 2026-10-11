/**
 * 响应信封 —— 后端所有 HTTP 响应的统一外形。
 *
 * ## 为什么用可辨识联合，而不是 `{ code, data, message }`
 *
 * 联合类型让 TypeScript 能**强制**调用方先判断成功与否再取 `data`：
 *
 *     const res = await api.getProduct(id)
 *     if (!res.ok) return renderError(res.code)   // 这里 res.data 取不到
 *     use(res.data)                                // 只有 ok 分支才有 data
 *
 * 而 `{ code, data, message }` 里 `data` 永远可选，忘写判断也不会报错 ——
 * 结果是线上出现"成功提示里显示 undefined"。
 *
 * ## 契约的铁律：信封里**不放成品文案**
 *
 * `code` 是给前端查 locale 用的键，不是给用户看的字符串。
 * 违反这条的症状：切到英文后，报错仍是中文（约束 `error-code-not-text`）。
 */

import type { ErrorCode } from './error-codes.js'

export interface ApiOk<T> {
  ok: true
  data: T
}

export interface ApiErr {
  ok: false
  /** 错误码 —— 前端据此查 locale 渲染文案，**不要**在这里放人类可读文案。 */
  code: ErrorCode
  /**
   * 结构化补充信息：字段名、限制值、冲突的 id 等**机器可读**的内容。
   * 同样不放文案 —— 需要展示的部分由前端按 key 组句。
   */
  meta?: Record<string, string | number | boolean>
}

export type ApiResponse<T> = ApiOk<T> | ApiErr

/** 分页信封。列表接口一律用它，避免各路由自己拼 `{ list, count }` 之类的变体。 */
export interface Page<T> {
  items: T[]
  total: number
  /** 从 1 开始。 */
  page: number
  pageSize: number
}

/** 分页查询的公共入参。 */
export interface PageQuery {
  page?: number
  pageSize?: number
}
