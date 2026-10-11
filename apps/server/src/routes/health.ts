/**
 * 健康检查（CO 域）。
 *
 * ## 为什么它必须返回**依赖的真实状态**，而不只是 `{"status":"ok"}`
 *
 * 反向代理、systemd 与部署脚本都会用它判断"服务好了没有"。
 * 若它恒定返回 ok，那么"数据库目录写不进去""迁移没跑完"这类问题
 * 会被代理层当成健康，请求被转发进来后才逐个失败 ——
 * 那时错误分散在业务接口上，排查方向完全不同。
 *
 * 所以这里回报：数据库实际路径、已应用迁移数、进程启动时间。
 * **不回报**任何凭据、密钥或完整环境变量。
 */

import type { FastifyInstance } from 'fastify'
import type { ApiResponse } from '@oenpc-web/shared'
import { nowIsoUtc } from '../db/dialect.js'

export interface HealthPayload {
  status: 'ok'
  /** ISO8601 UTC —— 存储与传输一律 UTC，展示层才转换。 */
  now: string
  uptimeSeconds: number
  database: {
    /** 实际使用的绝对路径：排查"数据写哪去了"的第一个线索。 */
    path: string
    appliedMigrations: number
  }
}

export interface HealthDeps {
  databasePath: string
  appliedMigrations: number
  startedAtMs: number
}

export function registerHealthRoutes(app: FastifyInstance, deps: HealthDeps): void {
  app.get('/api/health', async (): Promise<ApiResponse<HealthPayload>> => ({
    ok: true,
    data: {
      status: 'ok',
      now: nowIsoUtc(),
      uptimeSeconds: Math.round((Date.now() - deps.startedAtMs) / 1000),
      database: {
        path: deps.databasePath,
        appliedMigrations: deps.appliedMigrations,
      },
    },
  }))
}
