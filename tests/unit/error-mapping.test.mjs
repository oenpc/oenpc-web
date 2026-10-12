/**
 * 错误收敛的单元测试 —— 锁住一个**端到端验证里抓出来的真实 bug**。
 *
 * 早期版本把 Fastify 自己的 `statusCode` 丢掉了，一律降级成 INTERNAL 500。
 * 后果：上传不允许的文件类型被报成"服务端故障"，JSON 写坏也被报成 500 ——
 * 前端与告警都会往错的方向查。
 *
 * 这类 bug 的特点是**不报错、只是报错报得不对**，所以必须有测试钉住，
 * 否则下次重构错误处理器时会悄无声息地退回去。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AppError, statusOf, toAppError } from '../../apps/server/dist/core/errors.js'

/** 模拟 Fastify 抛出的错误：它带 statusCode 与 code，但不是 AppError。 */
function fastifyError(statusCode, code) {
  const error = new Error(code)
  error.statusCode = statusCode
  error.code = code
  return error
}

test('Fastify 的 415 收敛为 UNSUPPORTED_MEDIA_TYPE，不是 500', () => {
  const appError = toAppError(fastifyError(415, 'FST_ERR_CTP_INVALID_MEDIA_TYPE'))
  assert.equal(appError.code, 'UNSUPPORTED_MEDIA_TYPE')
  assert.equal(appError.status, 415)
})

test('Fastify 的 413 收敛为 PAYLOAD_TOO_LARGE（上传超限的真实状态码）', () => {
  const appError = toAppError(fastifyError(413, 'FST_ERR_CTP_BODY_TOO_LARGE'))
  assert.equal(appError.code, 'PAYLOAD_TOO_LARGE')
  assert.equal(appError.status, 413)
})

test('Fastify 的 400（JSON 解析失败）收敛为 BAD_REQUEST', () => {
  const appError = toAppError(fastifyError(400, 'FST_ERR_CTP_INVALID_JSON_BODY'))
  assert.equal(appError.code, 'BAD_REQUEST')
})

test('未知的 statusCode 仍然降级为 INTERNAL，不透传', () => {
  const appError = toAppError(fastifyError(418, 'FST_ERR_TEAPOT'))
  assert.equal(appError.code, 'INTERNAL')
  assert.equal(appError.status, 500)
})

test('不带 statusCode 的普通异常降级为 INTERNAL 且不透传 message', () => {
  const raw = new Error('SQLITE_ERROR: no such table: secret at /srv/app/data.db')
  const appError = toAppError(raw)
  assert.equal(appError.code, 'INTERNAL')
  assert.equal(appError.message, 'INTERNAL')
  assert.ok(!appError.message.includes('secret'))
})

test('已经是 AppError 的原样返回，不被 statusCode 逻辑改写', () => {
  const original = new AppError('FORBIDDEN')
  assert.equal(toAppError(original), original)
  assert.equal(statusOf('NOT_FOUND'), 404)
})
