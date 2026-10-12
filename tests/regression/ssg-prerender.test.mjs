/**
 * SSG 预渲染端到端回归 ——**把 P0.3 spike 的结论固化下来**。
 *
 * spike 如果只手工跑一次，它的结论第二次就没人能复现 —— 那正是骨架阶段我犯过的错
 * （一次性脚本验完即删）。这个文件守住的是**决策 2（URL 结构）与 hreflang 正确性**，
 * 而 URL 结构是对外公开、最贵、最不可逆的契约。
 *
 * ## 它验证的四件事
 *
 * 1. 每个语种都有独立可索引的 URL（`/<locale>/...`）
 * 2. `hreflang` 互指**指向各语种真正的 slug**，而不是把同一个 slug 套三个前缀
 * 3. 某个语种缺翻译时，**不产出该语种页面、也不宣告它**（避免软 404 与重复内容）
 * 4. 正文真的在 HTML 里（不是靠 JS 注入）—— 这是 SEO 的底线
 *
 * ## 为什么这里重复了一段服务端启动逻辑
 *
 * 目前有两个端到端测试各需要"起服务 + 灌数据"。两处时抽取的收益还盖不过间接层，
 * **出现第三个时就该抽成 `tests/lib/harness.mjs`**（家族的做法）。
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, openSync, closeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const SERVER_ENTRY = join(REPO, 'apps', 'server', 'dist', 'index.js')
const CLIENT_DIR = join(REPO, 'apps', 'web', 'dist', 'client')

/** 公开站点地址与 API 地址**故意不同** —— 验证两者确实解耦。 */
const SITE_URL = 'https://trade.example.com'
const PORT = Number(process.env.OENPC_WEB_TEST_PORT ?? 3990 + Math.floor(Math.random() * 9))
const API_BASE = `http://127.0.0.1:${PORT}`

let server
let workDir
let dbPath
let serverLog
let buildLog

function readIfExists(path, tail = 25) {
  try {
    return readFileSync(path, 'utf8').split('\n').slice(-tail).join('\n')
  } catch {
    return '(无日志)'
  }
}

async function waitForHealth(timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`服务提前退出（exit ${server.exitCode}）\n${readIfExists(serverLog)}`)
    }
    try {
      const response = await fetch(`${API_BASE}/api/health`)
      if (response.ok) return
    } catch {
      /* 还没起来 */
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`等待 /api/health 超时\n${readIfExists(serverLog)}`)
}

function run(command, args, { env, logPath }) {
  return new Promise((resolve, reject) => {
    const fd = openSync(logPath, 'a')
    const child = spawn(command, args, {
      cwd: REPO,
      /* shell 模式以兼容 Windows 上的 pnpm.cmd；不用管道，直接写日志文件 */
      shell: true,
      stdio: ['ignore', fd, fd],
      env: { ...process.env, ...env },
    })
    child.on('close', (code) => {
      closeSync(fd)
      if (code === 0) resolve()
      else reject(new Error(`命令失败（exit ${code}）：${command} ${args.join(' ')}\n${readIfExists(logPath, 40)}`))
    })
  })
}

function seed() {
  const db = new DatabaseSync(dbPath)
  const now = new Date().toISOString()
  const p = db.prepare(
    `INSERT INTO product (id, category_id, cover_media_id, published, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  const t = db.prepare(
    `INSERT INTO product_translation (product_id, locale, slug, name, summary, description)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  const c = db.prepare(
    `INSERT INTO purchase_channel (id, product_id, platform, url, label_json, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )

  /* 三语齐全 */
  p.run('p-pipe', null, null, 1, 1, now, now)
  t.run('p-pipe', 'zh', 'wufeng-gangguan', '无缝钢管', '高强度无缝钢管', '')
  t.run('p-pipe', 'en', 'seamless-steel-pipe', 'Seamless Steel Pipe', 'High strength', '')
  t.run('p-pipe', 'es', 'tubo-acero-sin-costura', 'Tubo de acero', 'Alta resistencia', '')
  c.run('ch-1', 'p-pipe', 'alibaba', 'https://example.com/a', null, 1)

  /* 只有英文 —— 不应产出 zh/es 页面 */
  p.run('p-en-only', null, null, 1, 2, now, now)
  t.run('p-en-only', 'en', 'en-only-widget', 'English Only Widget', 'Only in English', '')

  /* 未上架 —— 前台绝不出现 */
  p.run('p-draft', null, null, 0, 3, now, now)
  t.run('p-draft', 'en', 'draft-thing', 'Draft Thing', '', '')

  db.close()
}

function pagePath(urlPath) {
  return join(CLIENT_DIR, urlPath.replace(/^\/+/, ''), 'index.html')
}

function readPage(urlPath) {
  const file = pagePath(urlPath)
  assert.ok(existsSync(file), `应当产出页面：${urlPath}`)
  return readFileSync(file, 'utf8')
}

/** 取出 `<head>` 里所有 alternate 链接。 */
function alternates(html) {
  return [...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"\s*\/?>/g)].map(
    (match) => ({ hreflang: match[1], href: match[2] }),
  )
}

before(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'oenpc-web-ssg-'))
  dbPath = join(workDir, 'ssg.db')
  serverLog = join(workDir, 'server.log')
  buildLog = join(workDir, 'build.log')

  const serverFd = openSync(serverLog, 'a')
  server = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: REPO,
    env: {
      ...process.env,
      OENPC_WEB_PORT: String(PORT),
      OENPC_WEB_DB_PATH: dbPath,
      OENPC_WEB_MEDIA_DIR: join(workDir, 'media'),
      OENPC_WEB_LOG_LEVEL: 'warn',
      OENPC_WEB_SITE_URL: API_BASE,
    },
    stdio: ['ignore', serverFd, serverFd],
  })
  closeSync(serverFd)

  await waitForHealth()
  seed()

  /* 构建期从**运行中的 API** 取数据；站点地址与 API 地址不同，验证两者解耦 */
  await run('pnpm', ['--filter', '@oenpc-web/web', 'build'], {
    env: { OENPC_WEB_SITE_URL: SITE_URL, OENPC_WEB_API_BASE: API_BASE },
    logPath: buildLog,
  })
})

after(async () => {
  if (server && server.exitCode === null) {
    const exited = new Promise((resolve) => server.once('exit', resolve))
    server.kill()
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
    console.warn(`未能清理临时目录（不影响结论）：${workDir}`)
  }
})

test('每个语种都有独立可索引的首页与列表页', () => {
  for (const locale of ['zh', 'en', 'es']) {
    assert.ok(existsSync(pagePath(`/${locale}/`)), `缺少 /${locale}/`)
    assert.ok(existsSync(pagePath(`/${locale}/products`)), `缺少 /${locale}/products`)
  }
})

test('hreflang 互指**指向各语种真正的 slug**，而不是同一个 slug 套三个前缀', () => {
  const links = alternates(readPage('/en/products/seamless-steel-pipe'))

  const byLang = Object.fromEntries(links.map((link) => [link.hreflang, link.href]))
  assert.equal(byLang['en'], `${SITE_URL}/en/products/seamless-steel-pipe`)
  assert.equal(byLang['zh-Hans'], `${SITE_URL}/zh/products/wufeng-gangguan`)
  assert.equal(byLang['es'], `${SITE_URL}/es/products/tubo-acero-sin-costura`)
  assert.equal(byLang['x-default'], `${SITE_URL}/en/products/seamless-steel-pipe`)
})

test('hreflang 用 zh-Hans 而不是 zh —— 简繁是不同的内容', () => {
  const langs = alternates(readPage('/zh/products/wufeng-gangguan')).map((link) => link.hreflang)
  assert.ok(langs.includes('zh-Hans'), `实际：${langs.join(', ')}`)
  assert.ok(!langs.includes('zh'), '不应出现裸的 zh')
})

test('<html lang> 与 hreflang 同源', () => {
  assert.match(readPage('/en/products/seamless-steel-pipe'), /<html lang="en">/)
  assert.match(readPage('/zh/products/wufeng-gangguan'), /<html lang="zh-Hans">/)
})

test('canonical 指向自己', () => {
  const html = readPage('/es/products/tubo-acero-sin-costura')
  assert.match(
    html,
    /<link rel="canonical" href="https:\/\/trade\.example\.com\/es\/products\/tubo-acero-sin-costura"\s*\/>/,
  )
})

test('缺翻译的语种**不产出页面、也不被宣告** —— 否则是软 404 与重复内容', () => {
  const html = readPage('/en/products/en-only-widget')
  const langs = alternates(html).map((link) => link.hreflang)

  assert.deepEqual(langs, ['en', 'x-default'])

  assert.ok(!existsSync(pagePath('/zh/products/en-only-widget')), '不应产出 zh 版本')
  assert.ok(!existsSync(pagePath('/es/products/en-only-widget')), '不应产出 es 版本')
})

test('未上架的产品不产出任何页面', () => {
  assert.ok(!existsSync(pagePath('/en/products/draft-thing')))
  /* 连内容也不该出现在别的页面里 */
  assert.ok(!readPage('/en/products').includes('Draft Thing'))
})

test('正文在 HTML 里，不是靠 JS 注入（SEO 的底线）', () => {
  const html = readPage('/en/products/seamless-steel-pipe')
  const body = html.slice(html.indexOf('<div id="app">'), html.indexOf('window.__APP_DATA__'))

  assert.ok(body.includes('Seamless Steel Pipe'), '产品名必须在服务端渲染的 HTML 里')
  assert.ok(body.includes('High strength'), '摘要也必须在')
})

test('出站购买链接带 noopener noreferrer', () => {
  const html = readPage('/en/products/seamless-steel-pipe')
  const blanks = [...html.matchAll(/<a[^>]*target="_blank"[^>]*>/g)].map((match) => match[0])

  /* 种子数据里有一个渠道 —— 若这里为空，说明渠道没被渲染出来，那也是失败 */
  assert.ok(blanks.length > 0, '应当至少渲染出一个出站链接')

  for (const anchor of blanks) {
    assert.ok(anchor.includes('noopener'), `缺少 noopener：${anchor}`)
    assert.ok(anchor.includes('noreferrer'), `缺少 noreferrer：${anchor}`)
  }
})

test('水合数据已注入，且不含裸的 </script>', () => {
  const html = readPage('/en/products')
  assert.ok(html.includes('window.__APP_DATA__'))
  const payload = html.slice(html.indexOf('window.__APP_DATA__='), html.indexOf('</script>', html.indexOf('window.__APP_DATA__=')))
  assert.ok(!payload.includes('</script>'), '水合数据里不能出现未转义的 </script>')
})

test('根路径是跳转页，并给出 canonical 与 x-default', () => {
  const html = readFileSync(join(CLIENT_DIR, 'index.html'), 'utf8')
  assert.match(html, /rel="canonical"/)
  assert.match(html, /hreflang="x-default"/)
  assert.match(html, /http-equiv="refresh"/)
})

test('sitemap 覆盖全部产出页面，robots 指向 sitemap', () => {
  const sitemap = readFileSync(join(CLIENT_DIR, 'sitemap.xml'), 'utf8')
  assert.ok(sitemap.includes(`${SITE_URL}/en/products/seamless-steel-pipe`))
  assert.ok(sitemap.includes(`${SITE_URL}/zh/products/wufeng-gangguan`))
  assert.ok(!sitemap.includes('draft-thing'), 'sitemap 不应包含未上架产品')

  const robots = readFileSync(join(CLIENT_DIR, 'robots.txt'), 'utf8')
  assert.ok(robots.includes(`Sitemap: ${SITE_URL}/sitemap.xml`))
})
