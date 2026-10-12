/**
 * 领域错误与「不透传内部信息」的单元测试。
 *
 * 这一条值得单独测，因为它是一个**安全性质**，而不是行为细节：
 * 未知异常的原始 message 可能含 SQL、文件路径、内部标识；
 * 一旦透传给前端就是信息泄露，而这类泄露在安全评审前往往无人察觉。
 *
 * 跑的是**构建产物**（`apps/server/dist`）—— 与家族约定一致：
 * 回归跑 dist，所以改了源码要先 `pnpm build`（索引 §4 陷阱 P-02）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AppError, statusOf, toAppError } from '../../apps/server/dist/core/errors.js'

test('错误码 → HTTP 状态映射正确', () => {
  assert.equal(statusOf('NOT_FOUND'), 404)
  assert.equal(statusOf('BAD_REQUEST'), 400)
  assert.equal(statusOf('PAYLOAD_TOO_LARGE'), 413)
  assert.equal(statusOf('RATE_LIMITED'), 429)
  assert.equal(statusOf('INTERNAL'), 500)
})

test('AppError 的 message 是错误码，不是给人看的文案', () => {
  const error = new AppError('NOT_FOUND', { resource: 'product' })
  assert.equal(error.message, 'NOT_FOUND')
  assert.equal(error.status, 404)
  assert.deepEqual(error.meta, { resource: 'product' })
})

test('未知异常降级为 INTERNAL，且**不透传**原始 message', () => {
  const raw = new Error('SQLITE_ERROR: no such table: secret_table at /srv/app/data.db')
  const appError = toAppError(raw)

  assert.equal(appError.code, 'INTERNAL')
  assert.equal(appError.status, 500)
  /* 关键断言：原始信息不得出现在返回给前端的 message 里 */
  assert.equal(appError.message, 'INTERNAL')
  assert.ok(!appError.message.includes('secret_table'))
  assert.ok(!appError.message.includes('/srv/app'))
})

test('已经是 AppError 的原样返回，不重复包装', () => {
  const original = new AppError('FORBIDDEN')
  assert.equal(toAppError(original), original)
})

test('抛出非 Error 值（如字符串）也不崩', () => {
  const appError = toAppError('something odd')
  assert.equal(appError.code, 'INTERNAL')
})
