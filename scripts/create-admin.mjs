#!/usr/bin/env node
/**
 * 创建（或重置口令）一个后台管理员账号。
 *
 * 用法：
 *   node scripts/create-admin.mjs <用户名> <口令>            # 新建
 *   node scripts/create-admin.mjs <用户名> <口令> --reset    # 已存在则重置口令
 *   node scripts/create-admin.mjs <用户名> --owner           # 建为隐式全权（is_owner）
 *
 * ## 为什么不做"首次启动自动创建 admin/admin123"
 *
 * 那等于给每一个忘了改口令的部署留一个公开的后门，而"忘了改"是常态。
 * 显式跑一条命令的成本很低，换来的是**不存在默认凭据**这个性质。
 *
 * ## 为什么先 `pnpm build`
 *
 * 本脚本复用 `dist` 里的 scrypt 实现，而不是自己再写一遍 ——
 * 口令摘要算法只应该有一处实现。哈希算法若在两处分叉，
 * 症状是"用这个脚本建的口令登不进去"，而排查会一路查到登录逻辑。
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { hashPassword, MIN_PASSWORD_LENGTH } from '../apps/server/dist/core/passwords.js'
import { nowIsoUtc } from '../apps/server/dist/db/dialect.js'
import { migrate } from '../apps/server/dist/db/migrations.js'

const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
const flags = new Set(process.argv.slice(2).filter((arg) => arg.startsWith('--')))

const [username, password] = args

if (!username || (!password && !flags.has('--reset'))) {
  console.error(`用法：
  node scripts/create-admin.mjs <用户名> <口令>            新建账号
  node scripts/create-admin.mjs <用户名> <口令> --reset    重置已有账号的口令
  node scripts/create-admin.mjs <用户名> --owner           新建为隐式全权（仍需口令）`)
  process.exit(2)
}

if (username.trim().length < 3) {
  console.error('用户名至少 3 个字符')
  process.exit(2)
}

if (password !== undefined && password.length < MIN_PASSWORD_LENGTH) {
  console.error(`口令至少 ${MIN_PASSWORD_LENGTH} 个字符`)
  process.exit(2)
}
if (password !== undefined && password === username) {
  console.error('口令不能与用户名相同')
  process.exit(2)
}

const dbPath = resolve(process.env.OENPC_WEB_DB_PATH ?? 'data/oenpc-web.db')
mkdirSync(dirname(dbPath), { recursive: true })

const db = new DatabaseSync(dbPath)
/* 直接跑迁移：允许在服务尚未首次启动时就建账号 */
migrate(db)

const normalized = username.trim().toLowerCase()
const existing = db.prepare('SELECT id, is_owner FROM app_user WHERE username = ?').get(normalized)

if (existing && !flags.has('--reset')) {
  console.error(`用户 ${normalized} 已存在。若要改口令，加 --reset。`)
  db.close()
  process.exit(1)
}

const digest = hashPassword(password)
const now = nowIsoUtc()

if (existing) {
  db.prepare('UPDATE app_user SET password_salt = ?, password_hash = ?, updated_at = ? WHERE id = ?').run(
    digest.salt,
    digest.hash,
    now,
    existing.id,
  )
  /*
   * ★ 改口令后**必须**清掉该用户的全部会话。
   * 不清的后果是：口令改了，但之前泄露出去的令牌仍然有效 ——
   * 而用户改口令的动机往往正是"怀疑令牌泄露了"。
   */
  const sessions = db.prepare('DELETE FROM app_session WHERE user_id = ?').run(existing.id)
  db.close()
  console.log(`已重置 ${normalized} 的口令，并清除了 ${Number(sessions.changes ?? 0)} 个有效期内的会话。`)
  process.exit(0)
}

/*
 * 第一个账号**必须是全权** —— 否则没人有权限再创建账号或分配权限，
 * 系统会锁死。之后的账号默认不是全权（最小权限原则），要用 --owner 显式要求。
 */
const userCount = Number(db.prepare('SELECT COUNT(*) AS total FROM app_user').get()?.total ?? 0)
const isOwner = userCount === 0 || flags.has('--owner')

db.prepare(
  `INSERT INTO app_user
     (id, username, password_salt, password_hash, display_name, permissions_json, is_owner, disabled, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, '[]', ?, 0, ?, ?)`,
).run(randomUUID(), normalized, digest.salt, digest.hash, username.trim(), isOwner ? 1 : 0, now, now)

db.close()

console.log(`已创建管理员：${normalized}${isOwner ? '（隐式全权）' : '（无权限，需另行分配）'}
数据库：${dbPath}`)

if (!isOwner) {
  console.log(`
⚠ 该账号**没有任何权限**，登录后会看到"没有该操作的权限"。
  需要给它权限时，直接改库里的 permissions_json（本轮还没有权限管理界面）。`)
}

console.log(`
下一步：
  1. 启动服务（或重启）：systemctl restart oenpc-web-server
  2. 打开后台：http://<A机地址>/admin/`)
