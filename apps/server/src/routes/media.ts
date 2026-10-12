/**
 * 公开媒体服务（MD 域，`R` 层）—— `GET /media/:id`。
 *
 * ## 为什么由应用提供，而不是让 nginx 直接读磁盘
 *
 * nginx 在 A 机、媒体文件在 B 机，A 机读不到那目录；即便同机，
 * 直接暴露目录也意味着**任何人都能按文件名列举**。
 * 由应用按 id 提供还有一个好处：将来要给图片加访问控制（比如内部资料）
 * 只需改这一个路由，不必动 nginx。
 *
 * ## 缓存策略：`immutable` 是**安全的**，因为 id 与内容一一对应
 *
 * 每次上传都生成新 id，所以同一个 URL 的内容永不改变。这与"带版本号的静态资源"
 * 是同一类性质，因此可以放心用一年期的强缓存 —— 前台首屏对图片请求数很敏感
 * （索引 §4 的 PERF 面）。
 *
 * ⚠ 若将来允许"替换某个 id 的文件内容"，这条缓存策略必须同时改掉，
 * 否则用户会一直看到旧图，而刷新也不管用。所以这里不提供任何替换接口。
 */

import type { FastifyInstance } from 'fastify'
import { readFileSync } from 'node:fs'
import { AppError } from '../core/errors.js'
import type { MediaService } from '../services/media/service.js'

export interface PublicMediaRouteDeps {
  media: MediaService
}

export function registerPublicMediaRoutes(app: FastifyInstance, deps: PublicMediaRouteDeps): void {
  app.get('/media/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { absolutePath, asset } = deps.media.resolveFile(id)

    let bytes: Buffer
    try {
      bytes = readFileSync(absolutePath)
    } catch {
      /*
       * 库里有记录但磁盘上没文件 —— 数据不一致。返回 404 而不是 500：
       * 对访客来说这就是"图片不存在"，报 500 只会让错误监控里多一条无用的告警。
       * 真正该做的是让运维去查为什么文件没了（备份恢复、误删、磁盘故障）。
       */
      request.log.error({ mediaId: id, path: absolutePath }, '媒体记录存在但文件缺失')
      throw new AppError('NOT_FOUND', { resource: 'media' })
    }

    return reply
      .type(asset.mime)
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .header('X-Content-Type-Options', 'nosniff')
      .send(bytes)
  })
}
