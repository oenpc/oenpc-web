#!/usr/bin/env node
/**
 * 仓库布局下的薄包装 —— 真正的实现在 `apps/server/src/cli/create-admin.ts`。
 *
 * **不要在这里写第二份实现。** 口令摘要算法只应该有一处代码：
 * 两处分叉的症状是"用某个入口建的账号登不进去"，
 * 而排查会一路查到登录逻辑（`verifyPassword`），方向完全错。
 *
 * 发布包（把 dist 传到服务器）里直接跑：
 *   node dist/cli/create-admin.js <用户名> <口令>
 */

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const cli = join(here, '..', 'apps', 'server', 'dist', 'cli', 'create-admin.js')

if (!existsSync(cli)) {
  console.error(`找不到 ${cli}

请先构建：pnpm build
（发布包布局下改用：node dist/cli/create-admin.js <用户名> <口令>）`)
  process.exit(1)
}

await import(pathToFileURL(cli).href)
