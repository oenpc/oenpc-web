/**
 * 配置解析的单元测试。
 *
 * 配置错误的症状往往是**静默的**（进程照常启动、功能悄悄降级），
 * 所以这里重点测"该报错的时候是否真的报错"，而不是只测默认值。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../../apps/server/dist/config.js'

/*
 * ★ 基准目录必须**在当前平台上是绝对路径**，不能硬写 `C:/repo`。
 *
 * 早期版本硬写了 Windows 路径，于是测试在 Linux 上失败：
 * POSIX 下 `C:/repo` **不是**绝对路径，`path.resolve('C:/repo', 'data/x.db')`
 * 会把它当相对路径拼到 `process.cwd()` 后面（得到 `/opt/oenpc-web/C:/repo/data/x.db`）。
 *
 * 教训：测试里出现的路径必须由 `node:path` / `node:os` 生成，
 * 任何手写的盘符或分隔符都只会在作者那台机器上成立。
 */
const BASE = join(tmpdir(), 'oenpc-web-config-test')

test('全空环境变量时给出安全默认值', () => {
  const config = loadConfig({}, BASE)
  assert.equal(config.host, '127.0.0.1')
  assert.equal(config.port, 3900)
  assert.equal(config.logLevel, 'info')
  assert.equal(config.trustedProxy, false)
  assert.equal(config.isProduction, false)
})

test('端口非法**抛错**，不静默回落到默认值', () => {
  /* 静默回落会监听到意料之外的端口，而日志里看不出配置被忽略了 */
  assert.throws(() => loadConfig({ OENPC_WEB_PORT: 'abc' }, BASE), /不是合法端口/)
  assert.throws(() => loadConfig({ OENPC_WEB_PORT: '0' }, BASE), /不是合法端口/)
  assert.throws(() => loadConfig({ OENPC_WEB_PORT: '70000' }, BASE), /不是合法端口/)
})

test('日志级别非法抛错', () => {
  assert.throws(() => loadConfig({ OENPC_WEB_LOG_LEVEL: 'verbose' }, BASE), /取值非法/)
})

test('生产环境缺少 SITE_URL 直接抛错', () => {
  /*
   * 不报错的后果很具体：sitemap 与 hreflang 会生成指向错误域名的绝对地址，
   * 而且**不会报错** —— 搜索引擎收录的是一批打不开的链接。
   */
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }, BASE), /必须配置 OENPC_WEB_SITE_URL/)

  const ok = loadConfig({ NODE_ENV: 'production', OENPC_WEB_SITE_URL: 'https://example.com' }, BASE)
  assert.equal(ok.siteUrl, 'https://example.com')
})

test('trustedProxy 解析：空 / false / true / 地址列表', () => {
  assert.equal(loadConfig({}, BASE).trustedProxy, false)
  assert.equal(loadConfig({ OENPC_WEB_TRUSTED_PROXY: 'false' }, BASE).trustedProxy, false)
  assert.equal(loadConfig({ OENPC_WEB_TRUSTED_PROXY: 'true' }, BASE).trustedProxy, true)
  assert.deepEqual(loadConfig({ OENPC_WEB_TRUSTED_PROXY: '10.0.0.1, 10.0.0.2' }, BASE).trustedProxy, [
    '10.0.0.1',
    '10.0.0.2',
  ])
})

test('相对路径按传入的 cwd 解析成绝对路径', () => {
  const config = loadConfig({ OENPC_WEB_DB_PATH: 'data/x.db' }, BASE)

  assert.ok(config.dbPath.startsWith(BASE), `dbPath=${config.dbPath} 应当以 ${BASE} 开头`)
  assert.ok(config.dbPath.endsWith('x.db'))
  /* 同时确认结果确实是绝对路径 —— 这才是这条测试真正要保证的性质 */
  assert.ok(config.dbPath === join(BASE, 'data', 'x.db'), `实际：${config.dbPath}`)
})
