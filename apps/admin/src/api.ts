/*
 * API 客户端 —— **唯一**发请求的地方。
 *
 * ## 它替所有调用方处理三件重复的事
 *
 * 1. **信封解包**：后端一律返回 `{ ok, data }` / `{ ok, code, meta }`。
 *    这里把它转成"成功返回值 / 抛 ApiError"，调用方就不必到处写 `if (!res.ok)`。
 * 2. **错误码 → 可读信息**：`ApiError` 带 `code` 与 `meta`，
 *    视图按码决定提示文案（文案不放后端 —— 见硬约束 error-code-not-text）。
 * 3. **401 自动清理会话**：令牌失效时清掉本地令牌并跳登录页。
 *    若不做这一步，用户会停在页面上反复点、每次都失败，却不知道要重新登录。
 */

import type { ApiResponse, ErrorCode } from '@oenpc-web/shared'
import { getToken, setToken } from './session'

export class ApiError extends Error {
  readonly code: ErrorCode
  readonly meta?: Record<string, string | number | boolean>
  readonly status: number

  constructor(status: number, code: ErrorCode, meta?: Record<string, string | number | boolean>) {
    super(code)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.meta = meta
  }
}

/** 401 时由 main.ts 注册的回调（跳登录页）。 */
let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler
}

async function toApiError(response: Response): Promise<ApiError> {
  let code: ErrorCode = 'INTERNAL'
  let meta: Record<string, string | number | boolean> | undefined
  try {
    const body = (await response.json()) as ApiResponse<unknown>
    if (!body.ok) {
      code = body.code
      meta = body.meta
    }
  } catch {
    /* 响应不是 JSON（例如被 nginx 的 413 页面拦掉）—— 保留默认的 INTERNAL，
       但状态码仍然有用：调用方至少能看到 413/502 这类信息 */
  }
  return new ApiError(response.status, code, meta)
}

async function handle<T>(response: Response): Promise<T> {
  if (response.status === 401) {
    setToken(null)
    onUnauthorized?.()
    throw await toApiError(response)
  }
  if (!response.ok) throw await toApiError(response)

  const body = (await response.json()) as ApiResponse<T>
  if (!body.ok) throw new ApiError(response.status, body.code, body.meta)
  return body.data
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = getToken()
  return token === null ? extra : { ...extra, Authorization: `Bearer ${token}` }
}

export const api = {
  async get<T>(path: string): Promise<T> {
    return handle<T>(await fetch(path, { headers: authHeaders() }))
  },

  async post<T>(path: string, body: unknown): Promise<T> {
    return handle<T>(
      await fetch(path, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      }),
    )
  },

  async put<T>(path: string, body: unknown): Promise<T> {
    return handle<T>(
      await fetch(path, {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      }),
    )
  },

  async del<T>(path: string): Promise<T> {
    return handle<T>(await fetch(path, { method: 'DELETE', headers: authHeaders() }))
  },

  /**
   * 上传单个文件。
   *
   * 请求体**直接是文件字节**，类型由 `Content-Type` 表达（见后端
   * `routes/admin/media.ts` 的说明：单文件不需要 multipart）。
   * 文件名走 querystring，因为它**只用于展示**，不参与磁盘路径。
   */
  async upload<T>(path: string, file: File): Promise<T> {
    const url = `${path}?filename=${encodeURIComponent(file.name)}`
    return handle<T>(
      await fetch(url, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': file.type }),
        body: file,
      }),
    )
  },
}
