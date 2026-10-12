#!/usr/bin/env node
/**
 * 生产发布打包 —— 在**开发机**上构建并装配成可直接上传的自包含产物。
 *
 * ## 为什么需要它
 *
 * 本机的 `node_modules` **不能**直接传到 Linux：
 *   · pnpm 的子包 `node_modules` 里全是符号链接，真包在仓库根的 `.pnpm` 里；
 *   · Windows 上那些链接是**绝对路径**（`D:\工作区\...`），换机器即断。
 *
 * 所以这里装配出一个**不依赖 pnpm 布局**的产物：
 *   · 服务端只带 `dist/` + 一个把 `@oenpc-web/shared` 指向本地 `./shared` 的 package.json；
 *   · 在服务器上 `npm install --omit=dev` 即可装齐生产依赖（fastify 是纯 JS，无需编译）；
 *   · 静态产物已经是纯文件，直接给 nginx。
 *
 * ## 用法
 *
 *   # 前台是 SSG，构建期要从 API 拉数据 —— 所以必须先让**目标环境的 API 可访问**：
 *   OENPC_WEB_SITE_URL=http://172.19.3.47 \
 *   OENPC_WEB_API_BASE=http://172.19.229.191:3900 \
 *     node scripts/release.mjs
 *
 *   加 --skip-gates   跳过 typecheck/test（**不推荐**，只在紧急热修时用）
 *   加 --tar          额外打一个 tar.gz
 *
 * ## 关键点：`API_BASE` 要指向**服务器上的** API
 *
 * 若指向本机开发服务，打出来的静态页里是**你本地的产品**，
 * 传到服务器后页面内容与数据库对不上 —— 而且不会有任何报错。
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RELEASE = join(ROOT, 'release')
const STAGING = join(RELEASE, 'oenpc-web')

const SKIP_GATES = process.argv.includes('--skip-gates')
const MAKE_TAR = process.argv.includes('--tar')

const SITE_URL = (process.env.OENPC_WEB_SITE_URL ?? '').replace(/\/+$/, '')
const API_BASE = (process.env.OENPC_WEB_API_BASE ?? SITE_URL).replace(/\/+$/, '')

/**
 * 绝不进入发布包的路径片段。
 *
 * **只放"任何位置都不可能合法"的名字** —— 不要按 `data` 这类通用名排除：
 * 服务端 dist 里就有合法的 `dist/data/` 模块目录（`src/data/` 的产物），
 * 按名排除会直接把包打坏（这一条是家族项目用真实事故换来的）。
 */
const FORBIDDEN_NAMES = new Set(['node_modules', '.git', '.env', 'release', '.tmp-verify', 'coverage'])
const FORBIDDEN_SUFFIXES = ['.map', '.db', '.db-wal', '.db-shm', '.log', '.ts']

const steps = []
const problems = []

function log(message) {
  process.stdout.write(`${message}\n`)
}

function section(title) {
  log(`\n=== ${title} ===`)
}

function run(command, label) {
  log(`\n$ ${command}`)
  const started = Date.now()
  /* shell 以兼容 Windows；不用管道捕获输出，避免受限环境下的 spawn 失败 */
  const result = spawnSync(command, { shell: true, cwd: ROOT, stdio: 'inherit' })
  const ok = result.status === 0
  steps.push({ label, ok, seconds: Number(((Date.now() - started) / 1000).toFixed(1)) })
  if (!ok) {
    log(`\n发布中止：步骤失败 —— ${label}`)
    process.exit(1)
  }
}

function isForbidden(name) {
  const lower = name.toLowerCase()
  if (FORBIDDEN_NAMES.has(lower)) return true
  return FORBIDDEN_SUFFIXES.some((suffix) => lower.endsWith(suffix))
}

/** 递归复制并过滤；返回 {files, bytes}。 */
function copyFiltered(source, target) {
  const stats = { files: 0, bytes: 0 }
  const info = statSync(source)

  if (info.isDirectory()) {
    mkdirSync(target, { recursive: true })
    for (const entry of readdirSync(source)) {
      if (isForbidden(entry)) continue
      const child = copyFiltered(join(source, entry), join(target, entry))
      stats.files += child.files
      stats.bytes += child.bytes
    }
    return stats
  }

  mkdirSync(dirname(target), { recursive: true })
  cpSync(source, target)
  return { files: 1, bytes: info.size }
}

function copyTree(source, target, label) {
  if (!existsSync(source)) throw new Error(`${label} 不存在：${relative(ROOT, source)}（请先构建）`)
  const stats = copyFiltered(source, target)
  log(`  ${label.padEnd(22)} → ${relative(ROOT, target).replace(/\\/g, '/')}  (${stats.files} 个文件)`)
  return stats
}

/* ────────────────────────────── 前置检查 ────────────────────────────── */

section('前置检查')

if (SITE_URL === '') {
  log(`缺少 OENPC_WEB_SITE_URL。
它是**构建期烧进静态 HTML** 的公开站点地址（canonical / hreflang / sitemap 都用它生成绝对地址）。
例如：OENPC_WEB_SITE_URL=http://172.19.3.47`)
  process.exit(2)
}
log(`  站点地址 SITE_URL = ${SITE_URL}`)
log(`  数据来源 API_BASE = ${API_BASE}`)

try {
  const response = await fetch(`${API_BASE}/api/health`)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const body = await response.json()
  log(`  健康检查通过：已应用迁移 ${body?.data?.database?.appliedMigrations ?? '?'} 条`)
} catch (error) {
  log(`\n无法访问 API：${API_BASE}/api/health
  ${String(error.message)}

前台是 SSG，**构建期必须能从 API 拉数据**。请确认：
  · 应用已启动（在 B 机上：systemctl status oenpc-web-server）
  · OENPC_WEB_API_BASE 指向的是**目标环境**的 API，不是本机开发服务
  · 网络与防火墙允许访问该端口`)
  process.exit(2)
}

/* ────────────────────────────── 质量闸门与构建 ────────────────────────────── */

if (SKIP_GATES) {
  log('\n[!] 已跳过质量闸门（--skip-gates）')
} else {
  section('质量闸门')
  run('pnpm typecheck', 'typecheck')
  run('pnpm test', 'test')
}

section('构建')
run('pnpm build', '构建 shared + server')
run('pnpm --filter @oenpc-web/admin build', '构建后台 SPA')
run(
  `pnpm --filter @oenpc-web/web build`,
  '构建前台 SSG（构建期从 API 拉数据）',
)

/* ────────────────────────────── 装配 ────────────────────────────── */

section('装配')
rmSync(STAGING, { recursive: true, force: true })
mkdirSync(STAGING, { recursive: true })

let totals = { files: 0, bytes: 0 }
const add = (stats) => {
  totals.files += stats.files
  totals.bytes += stats.bytes
}

/* ── 服务端：dist + 自包含的 shared ── */

add(copyTree(join(ROOT, 'apps', 'server', 'dist'), join(STAGING, 'server', 'dist'), 'server/dist'))

/*
 * `packages/shared` 必须随包提供，因为服务端编译产物在**运行时**会
 * `import '@oenpc-web/shared'`（mapper / auth.sqlite / products.service / products.admin 四处）。
 *
 * 直接把它的 dist 当成一个本地包，并把 server 的依赖写成 `file:./shared` ——
 * 这样服务器上 `npm install` 就能解析，不需要 pnpm，也不需要 workspace。
 */
const sharedTarget = join(STAGING, 'server', 'shared')
add(copyTree(join(ROOT, 'packages', 'shared', 'dist'), sharedTarget, 'server/shared（契约包运行时）'))

const sharedPkg = JSON.parse(readFileSync(join(ROOT, 'packages', 'shared', 'package.json'), 'utf8'))
writeFileSync(
  join(sharedTarget, 'package.json'),
  `${JSON.stringify(
    {
      name: sharedPkg.name,
      version: sharedPkg.version,
      private: true,
      type: 'module',
      main: './index.js',
      types: './index.js',
      exports: { '.': { default: './index.js' } },
    },
    null,
    2,
  )}\n`,
)
log('  server/shared/package.json  （exports 指向编译后的 index.js）')

/* ── 服务端 package.json：把 workspace 依赖换成包内相对路径 ── */

const serverPkg = JSON.parse(readFileSync(join(ROOT, 'apps', 'server', 'package.json'), 'utf8'))
const dependencies = {}
for (const [name, version] of Object.entries(serverPkg.dependencies ?? {})) {
  dependencies[name] = String(version).startsWith('workspace:') ? 'file:./shared' : version
}

writeFileSync(
  join(STAGING, 'server', 'package.json'),
  `${JSON.stringify(
    {
      name: serverPkg.name,
      version: serverPkg.version,
      private: true,
      type: 'module',
      description: serverPkg.description,
      engines: { node: '>=22.19.0' },
      scripts: { start: 'node dist/index.js' },
      dependencies,
    },
    null,
    2,
  )}\n`,
)
log(`  server/package.json  （生产依赖 ${Object.keys(dependencies).length} 项，压缩包内不含 node_modules）`)

/* ── 静态产物 ── */

add(copyTree(join(ROOT, 'apps', 'web', 'dist', 'client'), join(STAGING, 'web'), 'web（前台静态）'))
add(copyTree(join(ROOT, 'apps', 'admin', 'dist'), join(STAGING, 'admin'), 'admin（后台静态）'))

/* ── 部署配置与文档 ── */

add(copyTree(join(ROOT, 'deploy'), join(STAGING, 'deploy'), 'deploy（配置模板）'))
add(copyTree(join(ROOT, 'docs'), join(STAGING, 'docs'), 'docs（含部署说明）'))

/* ── 产物审计 ── */

section('产物审计')

function audit(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const info = statSync(full)
    if (info.isDirectory()) {
      if (FORBIDDEN_NAMES.has(entry.toLowerCase())) {
        problems.push(`不允许的目录：${relative(STAGING, full)}`)
        continue
      }
      audit(full)
      continue
    }
    if (isForbidden(entry)) problems.push(`不允许的文件：${relative(STAGING, full)}`)
  }
}
audit(STAGING)

if (problems.length > 0) {
  log('发现不该进包的内容：')
  for (const item of problems) log(`  - ${item}`)
  log('\n发布中止。')
  process.exit(1)
}
log('  未发现 node_modules / .env / 数据文件 / sourcemap / TS 源码')

/* ────────────────────────────── 结果 ────────────────────────────── */

section('结果')
for (const step of steps) {
  log(`  ${step.ok ? 'PASS' : 'FAIL'}  ${step.label}${step.seconds ? `  (${step.seconds}s)` : ''}`)
}

const megabytes = (totals.bytes / 1024 / 1024).toFixed(2)
log(`\n装配目录：${relative(ROOT, STAGING).replace(/\\/g, '/')}   ${totals.files} 个文件 / ${megabytes} MB`)
log(`  站点地址已烧进前台页面：${SITE_URL}`)

if (MAKE_TAR) {
  const archive = join(RELEASE, 'oenpc-web-release.tar.gz')
  rmSync(archive, { force: true })
  const tar = spawnSync('tar', ['-czf', archive, '-C', RELEASE, 'oenpc-web'], { stdio: 'inherit' })
  if (tar.status !== 0) {
    log('\ntar 打包失败（不影响已装配的目录，可直接上传 release/oenpc-web/）。')
  } else {
    log(`压缩包：${relative(ROOT, archive).replace(/\\/g, '/')}  (${(statSync(archive).size / 1024 / 1024).toFixed(2)} MB)`)
  }
}

log(`
下一步 —— 分别上传（清单见 docs/部署说明.md）：

  B 机 172.19.229.191（应用）：
    sudo rsync -a release/oenpc-web/server/ /opt/oenpc-web/server/
    cd /opt/oenpc-web/server && sudo npm install --omit=dev
    sudo cp /opt/oenpc-web/server/deploy/env.production.example /opt/oenpc-web/server/.env
    sudo -u oenpc-web OENPC_WEB_DB_PATH=/opt/oenpc-web/data/oenpc-web.db \\
      node dist/cli/create-admin.js admin '<强口令>'

  A 机 172.19.3.47（静态）：
    sudo rsync -a release/oenpc-web/web/   /var/www/oenpc-web/site/
    sudo rsync -a release/oenpc-web/admin/ /var/www/oenpc-web/admin/
    sudo cp release/oenpc-web/deploy/nginx.conf /etc/nginx/conf.d/oenpc-web.conf
`)
