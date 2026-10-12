/**
 * 服务端进程入口（`E` 层）。
 *
 * ## 顺序是有讲究的：配置 → 连库 → 迁移 → 装配 → 监听
 *
 * **迁移必须在 `listen` 之前完成。** 若先监听再迁移，启动瞬间进来的请求
 * 会打到半套表结构上，表现为随机的 500 —— 而这些 500 与"正在迁移"的因果关系
 * 在日志里几乎看不出来。
 *
 * ## 优雅退出
 *
 * `SIGTERM` 是 systemd 停止服务的默认信号。不处理它，进程会被直接杀掉：
 * 正在写的 SQLite 事务可能留下 `-wal` 文件，A 机 nginx 也会把连接断成 502。
 * 所以这里先 `app.close()`（停止接收新请求、等待在途请求结束）再关库。
 */

import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { openDatabase } from './db/connection.js'
import { migrate } from './db/migrations.js'
import { createSqliteProductRepository } from './repositories/products/sqlite.js'

async function main(): Promise<void> {
  const startedAtMs = Date.now()

  const config = loadConfig()
  const opened = openDatabase(config.dbPath)
  const migration = migrate(opened.db)

  const app = buildApp({
    config,
    /*
     * 装配点只有这一处。换 PostgreSQL 时，这里把 createSqliteProductRepository
     * 换成 createPostgresProductRepository 即可 —— 服务层与路由层都不用动。
     */
    repositories: {
      products: createSqliteProductRepository(opened.db),
    },
    databasePath: opened.path,
    appliedMigrations: migration.applied.length,
    startedAtMs,
  })

  if (migration.applied.length > 0) {
    app.log.info({ applied: migration.applied }, '数据库迁移已应用')
  } else {
    app.log.info({ migrations: migration.skipped }, '数据库结构已是最新')
  }

  let shuttingDown = false
  const shutdown = async (signal: string): Promise<void> => {
    /* 防止连按两次 Ctrl-C 触发两次关闭流程。 */
    if (shuttingDown) return
    shuttingDown = true

    app.log.info({ signal }, '正在优雅退出')
    try {
      await app.close()
    } finally {
      opened.close()
    }
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))

  await app.listen({ host: config.host, port: config.port })

  app.log.info(
    {
      database: opened.path,
      siteUrl: config.siteUrl === '' ? '(未配置)' : config.siteUrl,
      timezone: config.defaultTimezone,
    },
    '服务已就绪',
  )
}

main().catch((error: unknown) => {
  /*
   * 启动阶段失败必须**非零退出** —— systemd 据此判定启动失败并重试；
   * 若退出码为 0，服务会被当成"正常结束"，不会重启。
   */
  console.error('启动失败：', error)
  process.exit(1)
})
