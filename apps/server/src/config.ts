/**
 * 环境变量解析 —— 全仓库**唯一**读 `process.env` 的地方。
 *
 * ## 为什么集中在一处
 *
 * 散落的 `process.env.X` 会让"这个服务到底依赖哪些配置"无法回答，
 * 而漏配的症状往往是**静默的**：进程照常启动，功能悄悄降级。
 * 集中之后，`loadConfig()` 就是配置的完整清单，且能在启动时一次性校验。
 *
 * ## 相对路径按进程工作目录解析 —— 这是个坑
 *
 * `OENPC_WEB_DB_PATH=data/oenpc-web.db` 相对于 **cwd**，不是相对于源码目录。
 * 于是从仓库根启动与从 `apps/server` 启动会写到两个不同的文件。
 * **测试要隔离必须传绝对路径**，否则会写进仓库的 `data/` 里。
 */

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface ServerConfig {
  host: string
  port: number
  /** 绝对路径。 */
  dbPath: string
  /** 绝对路径。 */
  mediaDir: string
  /**
   * 后台 SPA 产物目录（绝对路径）。**为空表示不由本进程提供后台。**
   *
   * 部署形态是「A 机只跑前台站点，B 机跑 admin + server」，
   * 所以后台 SPA 由**应用进程**直接发出（见 app.ts 的静态注册）——
   * 不可能让 A 机的 nginx 去 alias 一个位于 B 机上的目录。
   *
   * 默认指向仓库里的 `apps/admin/dist`，正好是 `pnpm build` 的产物位置，
   * 所以按源码树部署（`/opt/oenpc-web`）时不需要额外配置。
   */
  adminDir: string
  logLevel: LogLevel
  /** 站点默认时区，**只影响后台展示**；存储一律 UTC。 */
  defaultTimezone: string
  /** 公开站点根地址，用于生成绝对 URL（sitemap / hreflang）。生产环境必须显式配置。 */
  siteUrl: string
  /**
   * 可信反向代理。
   *
   * `false` = 不信任任何 `X-Forwarded-*`（直连时正确）；
   * `string[]` = 只信任这些地址/CIDR（A 机 nginx 反代时正确）；
   * `true` = 信任一切 —— **危险**，客户端可伪造 `X-Forwarded-For` 绕过按 IP 限流。
   */
  trustedProxy: boolean | string[]
  isProduction: boolean
}

const ENV_PREFIX = 'OENPC_WEB_'
const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error']

function readString(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const raw = env[`${ENV_PREFIX}${name}`]
  return raw === undefined || raw.trim() === '' ? fallback : raw.trim()
}

function readPort(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[`${ENV_PREFIX}${name}`]
  if (raw === undefined || raw.trim() === '') return fallback
  const value = Number(raw)
  /* 端口写错就中止 —— 不要静默回落到默认值，否则会监听到意料之外的端口。 */
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${ENV_PREFIX}${name} 不是合法端口：${raw}`)
  }
  return value
}

function readLogLevel(env: NodeJS.ProcessEnv): LogLevel {
  const raw = readString(env, 'LOG_LEVEL', 'info').toLowerCase()
  if (!LOG_LEVELS.includes(raw as LogLevel)) {
    throw new Error(`${ENV_PREFIX}LOG_LEVEL 取值非法：${raw}（可选 ${LOG_LEVELS.join(' / ')}）`)
  }
  return raw as LogLevel
}

/**
 * 解析可信代理。
 *
 * 为什么默认 `false`：本进程在生产里位于 A 机 nginx 之后，但**开发时是直连的**。
 * 若默认信任转发头，任何人都能用 `X-Forwarded-For` 伪造来源 IP，
 * 绕过登录限流（F7.5）与审计里的来源记录。宁可让部署方显式配置。
 *
 * 而**不配**它的后果也很具体：所有访客看起来都是 A 机的 IP，
 * 于是"按 IP 限流"变成"限流全站"——第一次暴力破解就把所有正常用户一起封了。
 * 这是一个"忘了配就出事，而且症状与原因相距很远"的配置项。
 */
function readTrustedProxy(env: NodeJS.ProcessEnv): boolean | string[] {
  const raw = readString(env, 'TRUSTED_PROXY', '')
  if (raw === '' || raw === 'false') return false
  if (raw === 'true') return true
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
}

/**
 * 解析配置。传入 `env` / `cwd` 而不是直接读全局，是为了让测试能注入。
 *
 * @param env 环境变量表，默认 `process.env`
 * @param cwd 用于解析相对路径的工作目录，默认 `process.cwd()`
 */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): ServerConfig {
  const isProduction = env.NODE_ENV === 'production'
  const siteUrl = readString(env, 'SITE_URL', '')

  /*
   * 生产环境要求显式配置站点地址：sitemap 与 hreflang 需要**绝对** URL，
   * 猜一个默认值只会产出一份指向错误域名的 sitemap，而且不会报错。
   */
  if (isProduction && siteUrl === '') {
    throw new Error(
      `生产环境必须配置 ${ENV_PREFIX}SITE_URL —— 否则 sitemap 与 hreflang 无法生成正确的绝对地址。`,
    )
  }

  /*
   * 后台 SPA 目录。三种取值：
   *   · 未配置      -> 用**相对模块自身位置**推出的默认值（见下）
   *   · 空串        -> 明确表示"本进程不提供后台界面"
   *   · 相对/绝对路径 -> 按 cwd 解析
   *
   * ★ 默认值不能写成 `apps/admin/dist` 再按 cwd 解析。
   *   systemd 的工作目录是 apps/server，于是会得到
   *   /opt/oenpc-web/apps/server/apps/admin/dist —— 不存在，
   *   而后台界面表现为 404，且日志里只有一句轻描淡写的"未提供后台"。
   *
   *   改成相对**本模块**位置：本文件在 apps/server/{src,dist}/ 下，
   *   上两级再进 admin/dist 恰好是产物位置，且对三种布局都成立：
   *     dev      apps/server/src  -> apps/admin/dist
   *     源码树    apps/server/dist -> apps/admin/dist
   *     发布包    server/dist      -> admin/dist
   *   与进程的工作目录无关。
   */
  const rawAdminDir = env[`${ENV_PREFIX}ADMIN_DIR`]
  const defaultAdminDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'admin', 'dist')
  const adminDir =
    rawAdminDir === undefined
      ? defaultAdminDir
      : rawAdminDir === ''
        ? ''
        : resolve(cwd, rawAdminDir)

  return {
    host: readString(env, 'HOST', '127.0.0.1'),
    port: readPort(env, 'PORT', 3900),
    dbPath: resolve(cwd, readString(env, 'DB_PATH', 'data/oenpc-web.db')),
    mediaDir: resolve(cwd, readString(env, 'MEDIA_DIR', 'data/media')),
    adminDir,
    logLevel: readLogLevel(env),
    defaultTimezone: readString(env, 'DEFAULT_TIMEZONE', 'Asia/Shanghai'),
    siteUrl,
    trustedProxy: readTrustedProxy(env),
    isProduction,
  }
}
