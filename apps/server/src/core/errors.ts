/**
 * 领域核心：错误类型与 HTTP 状态映射。
 *
 * ## 为什么这一层不碰 Fastify
 *
 * `C` 层（Core）是**无框架依赖**的领域逻辑 —— 这里不 import `fastify`、
 * 不碰 `req` / `reply`。这样它可以被单测直接调用，而不必起一个 HTTP 服务。
 * 需要 `reply` 的转换在 `app.ts` 的错误处理器里做，那是 `E` 层的职责。
 *
 * ## 为什么错误里带的是码而不是文案
 *
 * `AppError.code` 来自契约包的封闭枚举。文案由前端按语种渲染 ——
 * 后端一旦返回中文文案，切到英文时错误提示就仍是中文（硬约束 `error-code-not-text`）。
 */

import type { ErrorCode } from '@oenpc-web/shared'

/**
 * 错误码 → HTTP 状态码。
 *
 * 这是**运行时映射**，所以它在服务端而不在契约包里 ——
 * 契约包只放类型与枚举（约束 `shared-contract`）。
 */
const HTTP_STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  NOT_IMPLEMENTED: 501,
}

export class AppError extends Error {
  readonly code: ErrorCode
  readonly status: number
  /** 机器可读的补充信息（字段名、限制值），**不放文案**。 */
  readonly meta?: Record<string, string | number | boolean>

  constructor(code: ErrorCode, meta?: Record<string, string | number | boolean>) {
    /*
     * message 只用于**服务端日志**，不是给用户看的。
     * 把它设成 code，是为了让日志里一眼能看出码；真正的可读描述在日志的字段里。
     * 这样也能防止有人顺手把中文文案写进 message 然后被透传给前端。
     */
    super(code)
    this.name = 'AppError'
    this.code = code
    this.status = HTTP_STATUS[code]
    this.meta = meta
  }
}

export function statusOf(code: ErrorCode): number {
  return HTTP_STATUS[code]
}

/** HTTP 状态码 → 错误码。用于把 Fastify 自身的错误收敛进我们的信封。 */
const CODE_FOR_STATUS: Record<number, ErrorCode> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'RATE_LIMITED',
  501: 'NOT_IMPLEMENTED',
}

/**
 * 把任意抛出物收敛成 `AppError`。
 *
 * ## 必须**先看 Fastify 自己的 statusCode**
 *
 * Fastify 在进入我们的 handler 之前就会抛一批错误，它们**带 `statusCode`**：
 *   · 不支持的 Content-Type → 415
 *   · 请求体超过 bodyLimit → 413
 *   · JSON 解析失败 → 400
 *
 * 早期版本不看 `statusCode`，一律降级成 INTERNAL 500 ——
 * 后果是"上传了不允许的文件类型"被报成 500（服务端故障），
 * 前端与告警都会往错的方向查：前端以为后端崩了，运维收到一堆假告警。
 * **客户端错误伪装成服务端错误，比报错本身更麻烦。**
 * （这个 bug 是在端到端验证第 5 项里被抓出来的。）
 *
 * ## 未知异常仍然降级为 INTERNAL，且不透传 message
 *
 * 原始 message 可能含 SQL、文件路径或内部标识，直接返回给前端等于信息泄露。
 * 完整信息应进服务端日志（由 `E` 层的错误处理器负责）。
 */
export function toAppError(thrown: unknown): AppError {
  if (thrown instanceof AppError) return thrown

  const status = (thrown as { statusCode?: unknown } | null | undefined)?.statusCode
  if (typeof status === 'number') {
    const code = CODE_FOR_STATUS[status]
    if (code) return new AppError(code)
  }

  return new AppError('INTERNAL')
}
