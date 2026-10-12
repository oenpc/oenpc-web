/**
 * 产品 API 端到端回归（PD 域）。
 *
 * ## 这个文件为什么存在
 *
 * 骨架阶段我用一次性脚本验证了 6 项行为，**验完就把脚本删了** ——
 * 于是那些结论第二次就没人能复现。这个文件把它们固化下来。
 *
 * 它对应 `AGENTS.md` 的「一个功能一个回归脚本」：**改这个脚本，不要新建序号脚本**。
 *
 * ## 三条实现约定（都是踩过坑才这么写的）
 *
 * 1. **跑的是构建产物** `apps/server/dist/index.js`，不是源码。
 *    所以改了源码要先 `pnpm build`，否则跑的是旧行为（索引 §4 陷阱 P-02）。
 * 2. **子进程不用管道**（`stdio` 直接给文件描述符）—— 受限环境下
 *    通过管道捕获子进程输出会失败。日志写文件，超时时再读出来打印。
 * 3. **端口可被环境变量覆盖**，默认在 3910–3989 里随机取一个，避免与开发服务撞端口。
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, openSync, closeSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const SERVER_ENTRY = join(REPO, 'apps', 'server', 'dist', 'index.js')

const PORT = Number(process.env.OENPC_WEB_TEST_PORT ?? 3910 + Math.floor(Math.random() * 80))
const BASE = `http://127.0.0.1:${PORT}`

let child
let workDir
let dbPath
let logPath

function serverLog() {
  try {
    return readFileSync(logPath, 'utf8').split('\n').slice(-30).join('\n')
  } catch {
    return '(无日志)'
  }
}

async function api(path) {
  const response = await fetch(`${BASE}${path}`)
  return { status: response.status, body: await response.json() }
}

async function waitForHealth(timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`服务提前退出（exit ${child.exitCode}）\n${serverLog()}`)
    }
    try {
      const response = await fetch(`${BASE}/api/health`)
      if (response.ok) return
    } catch {
      /* 还没起来，继续等 */
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`等待 /api/health 超时（${timeoutMs}ms）\n${serverLog()}`)
}

function seed() {
  const db = new DatabaseSync(dbPath)
  const now = new Date().toISOString()

  const insertProduct = db.prepare(
    `INSERT INTO product (id, category_id, cover_media_id, published, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  const insertTranslation = db.prepare(
    `INSERT INTO product_translation (product_id, locale, slug, name, summary, description)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  const insertChannel = db.prepare(
    `INSERT INTO purchase_channel (id, product_id, platform, url, label_json, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )

  insertProduct.run('p-pub', null, null, 1, 1, now, now)
  insertProduct.run('p-draft', null, null, 0, 2, now, now)

  insertTranslation.run('p-pub', 'zh', 'gangguan', '无缝钢管', '', '')
  insertTranslation.run('p-pub', 'en', 'steel-pipe', 'Seamless Steel Pipe', '', '')
  insertTranslation.run('p-pub', 'es', 'tubo-acero', 'Tubo de acero', '', '')
  insertTranslation.run('p-draft', 'en', 'draft-item', 'Draft Item', '', '')

  insertChannel.run('ch-1', 'p-pub', 'alibaba', 'https://example.com/a', null, 1)
  /* 故意插一个枚举外的平台，验证它被丢弃而不是渲染成空按钮 */
  insertChannel.run('ch-2', 'p-pub', 'bogus-platform', 'https://example.com/b', null, 2)

  db.close()
}

before(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'oenpc-web-regression-'))
  dbPath = join(workDir, 'test.db')
  logPath = join(workDir, 'server.log')

  const logFd = openSync(logPath, 'a')
  child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: REPO,
    env: {
      ...process.env,
      OENPC_WEB_PORT: String(PORT),
      OENPC_WEB_DB_PATH: dbPath,
      OENPC_WEB_MEDIA_DIR: join(workDir, 'media'),
      OENPC_WEB_LOG_LEVEL: 'info',
      OENPC_WEB_SITE_URL: BASE,
    },
    /* 不用管道：受限环境下通过管道捕获子进程输出会失败 */
    stdio: ['ignore', logFd, logFd],
  })
  closeSync(logFd)

  await waitForHealth()
  seed()
})

after(async () => {
  /*
   * 必须先**等子进程真正退出**再删目录。
   * Windows 上文件句柄在进程退出后还有短暂延迟，立刻 rmSync 会 EBUSY/EPERM ——
   * 这个坑的表现是"所有断言都通过，但整个测试文件报失败"，很容易被误读成业务失败。
   */
  if (child && child.exitCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve))
    child.kill()
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))])
  }

  if (workDir) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        rmSync(workDir, { recursive: true, force: true })
        return
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
    }
    /* 删不掉不算测试失败 —— 临时目录在系统 temp 里，不污染仓库 */
    console.warn(`未能清理临时目录（不影响结论）：${workDir}`)
  }
})

test('健康检查回报依赖的真实状态，而不是恒定的 ok', async () => {
  const { status, body } = await api('/api/health')
  assert.equal(status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.data.status, 'ok')
  assert.ok(body.data.database.appliedMigrations >= 1, '至少要应用过 1 条迁移')
  assert.ok(body.data.database.path.endsWith('test.db'))
  /* 时间是 UTC 且带 Z —— 存储与传输一律 UTC（硬约束 utc-storage） */
  assert.match(body.data.now, /Z$/)
})

test('公开列表：未上架的产品**不得出现**', async () => {
  const { status, body } = await api('/api/products?locale=en')
  assert.equal(status, 200)
  assert.equal(body.data.total, 1)
  assert.deepEqual(body.data.items.map((item) => item.id), ['p-pub'])
})

test('列表项带齐**全部语种**的 slug —— hreflang 需要它生成互指链接', async () => {
  const { body } = await api('/api/products?locale=en')
  assert.deepEqual(Object.keys(body.data.items[0].slug).sort(), ['en', 'es', 'zh'])
  assert.equal(body.data.items[0].slug.es, 'tubo-acero')
})

test('关键词搜索命中（按请求语种匹配名称）', async () => {
  const hit = await api('/api/products?locale=en&keyword=Steel')
  assert.equal(hit.body.data.total, 1)

  const miss = await api('/api/products?locale=en&keyword=不存在的东西')
  assert.equal(miss.body.data.total, 0)
})

test('LIKE 的 % 被转义：搜索 % 返回 0 条，而不是匹配全部', async () => {
  /* 不转义的话这里会返回 1 条（等于把搜索变成全表扫描） */
  const { body } = await api('/api/products?locale=en&keyword=%25')
  assert.equal(body.data.total, 0)
})

test('未上架的详情返回 404（而非 403，不泄漏"存在但你看不到"）', async () => {
  const { status, body } = await api('/api/products/p-draft')
  assert.equal(status, 404)
  assert.equal(body.ok, false)
  assert.equal(body.code, 'NOT_FOUND')
})

test('渠道里枚举外的平台被丢弃', async () => {
  const { body } = await api('/api/products/p-pub')
  assert.equal(body.data.channels.length, 1)
  assert.equal(body.data.channels[0].platform, 'alibaba')
})

test('已上架详情返回完整外形，且 published 是 boolean 而不是 1', async () => {
  const { status, body } = await api('/api/products/p-pub')
  assert.equal(status, 200)
  assert.equal(body.data.published, true)
  assert.equal(typeof body.data.published, 'boolean')
  assert.equal(body.data.name.zh, '无缝钢管')
})

test('非法语种 → 400，不静默回落到默认语种', async () => {
  const { status, body } = await api('/api/products?locale=de')
  assert.equal(status, 400)
  assert.equal(body.code, 'BAD_REQUEST')
  assert.equal(body.meta.field, 'locale')
})

test('非法分页参数 → 400，不静默纠正', async () => {
  for (const bad of ['abc', '0', '-3']) {
    const { status, body } = await api(`/api/products?locale=en&page=${bad}`)
    assert.equal(status, 400, `page=${bad} 应当 400`)
    assert.equal(body.code, 'BAD_REQUEST')
  }
})

test('未知路由也走响应信封，不返回框架默认形状', async () => {
  const { status, body } = await api('/api/does-not-exist')
  assert.equal(status, 404)
  assert.equal(body.ok, false)
  assert.equal(body.code, 'NOT_FOUND')
})
