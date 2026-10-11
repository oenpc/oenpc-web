/**
 * 错误码 —— **封闭枚举**。
 *
 * ## 为什么后端只返回码，不返回成品文案
 *
 * 后端返回 `"NOT_FOUND"`，前端按用户当前语种渲染成「未找到」/「Not found」/「No encontrado」。
 * 若后端直接返回中文文案，那么**后端就无法多语言** —— 切到英文时错误提示仍是中文，
 * 除非把翻译表塞进后端（那就等于把 N 层复制了一份）。
 *
 * 这条由约束 `error-code-not-text` 守着（目前无执行形态，见 strata/constraints.mjs）。
 *
 * ## 语义边界
 *
 * 这里只放**码**。HTTP 状态码映射、日志级别、是否可重试 —— 都属于服务端运行时逻辑，
 * 放在 `apps/server/src/core/errors.ts`，**不要**放进契约包（约束 `shared-contract`）。
 */

export const ERROR_CODES = [
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'RATE_LIMITED',
  'INTERNAL',
  'NOT_IMPLEMENTED',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]
