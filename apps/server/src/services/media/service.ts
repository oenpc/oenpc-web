/**
 * 媒体服务（MD 域）—— 上传校验、落盘、引用保护。
 *
 * ## 四个安全/正确性决定
 *
 * ### 1. 允许的 mime 是**白名单**，且**不含 SVG**
 *
 * SVG 是 XML，可以内嵌 `<script>`。同源提供上传的 SVG 就等于给了攻击者一个
 * **存储型 XSS 的载体** —— 而这偏偏是"上传图片"功能最容易漏掉的一条。
 * 需要矢量图时应当转成 PNG，或放在**独立域名**下并加 `Content-Disposition`。
 *
 * ### 2. 磁盘路径**从 id + mime 推导**，绝不用上传的原始文件名
 *
 * 原始文件名可能含 `../`、空字节、超长串。它只存进库用于展示。
 * 读取时先按 id 查库、再用库里的 mime 推路径 —— 于是**不存在的 id 直接 404**，
 * 路径穿越在结构上就不可能（攻击者无法让库返回一条他自己编的记录）。
 *
 * ### 3. 删除前**必须**查引用计数
 *
 * 删掉仍被产品引用的图片会让前台 404，而那个 404 出现在产品页上，
 * 看起来像"图片丢了"，不像"有人在媒体库里删了东西"（陷阱 P-14）。
 *
 * ### 4. 不在这里做图片压缩
 *
 * 压缩需要原生依赖（sharp），会让"上传即可跑"的部署目标变复杂。
 * 本轮先按原样存储 + 大小上限。**图片优化是已知缺口**，见文件末尾的说明。
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { MediaAsset } from '@oenpc-web/shared'
import { AppError } from '../../core/errors.js'
import type { AuditRepository } from '../../repositories/audit/port.js'
import type { MediaAssetRecord, MediaRepository } from '../../repositories/media/port.js'

/**
 * 允许上传的 mime → 扩展名。
 *
 * **不含 `image/svg+xml`**，理由见文件头第 1 条。
 * 这张表只增不改 —— 磁盘上的文件名依赖它做确定性重建。
 */
const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
}

/** 单文件大小上限。与 nginx 的 `client_max_body_size` 必须**同时**放开（陷阱 P-05）。 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

export interface MediaServiceDeps {
  media: MediaRepository
  audit: AuditRepository
  /** 媒体文件目录（绝对路径）。 */
  mediaDir: string
  now?: () => Date
}

export interface UploadInput {
  filename: string
  mime: string
  bytes: Buffer
  actor: { id: string; name: string }
}

export interface MediaService {
  upload(input: UploadInput): MediaAsset
  list(page: number, pageSize: number): { items: MediaAsset[]; total: number; page: number; pageSize: number }
  /** 取磁盘路径 + 记录，供路由流式返回。不存在时抛 404。 */
  resolveFile(id: string): { absolutePath: string; asset: MediaAsset }
  remove(id: string, actor: { id: string; name: string }): void
}

function toAsset(record: MediaAssetRecord): MediaAsset {
  return {
    id: record.id,
    filename: record.filename,
    mime: record.mime,
    byteSize: record.byteSize,
    width: record.width,
    height: record.height,
    createdAt: record.createdAt,
    /* 相对路径：站点与 API 同源反代，换域名时历史数据无影响（见 contract/media.ts） */
    url: `/media/${record.id}`,
  }
}

/**
 * 从 id 与 mime 推导磁盘文件名。
 *
 * mime 不在白名单时**抛错而不是猜扩展名** —— 库里的 mime 只可能来自上传时的白名单，
 * 出现别的值说明数据被外部改过，这时宁可报错也不要生成一个可能指向别处的路径。
 */
function storedName(id: string, mime: string): string {
  const extension = ALLOWED_MIME[mime]
  if (!extension) throw new AppError('UNSUPPORTED_MEDIA_TYPE', { mime })
  return `${id}${extension}`
}

export function createMediaService(deps: MediaServiceDeps): MediaService {
  const now = deps.now ?? (() => new Date())
  const mediaDir = resolve(deps.mediaDir)
  mkdirSync(mediaDir, { recursive: true })

  function audit(action: string, actor: { id: string; name: string }, detail?: Record<string, unknown>) {
    try {
      deps.audit.append({
        id: randomUUID(),
        actorId: actor.id,
        actorName: actor.name,
        action,
        objectType: 'media',
        now: now().toISOString(),
        ...(detail ? { detail } : {}),
      })
    } catch (error) {
      console.error('[audit] 写入失败（已忽略，不影响业务）：', error)
    }
  }

  return {
    upload({ filename, mime, bytes, actor }) {
      /*
       * 服务端校验类型与体积 —— **不信任前端**。
       * 前端的 accept 只是 UI 提示，绕过它易如反掌（改请求、用 curl）。
       */
      if (!ALLOWED_MIME[mime]) {
        throw new AppError('UNSUPPORTED_MEDIA_TYPE', { mime, allowed: Object.keys(ALLOWED_MIME).join(', ') })
      }
      if (bytes.byteLength === 0) {
        throw new AppError('BAD_REQUEST', { reason: 'empty_body' })
      }
      if (bytes.byteLength > MAX_UPLOAD_BYTES) {
        throw new AppError('PAYLOAD_TOO_LARGE', { maxBytes: MAX_UPLOAD_BYTES, actualBytes: bytes.byteLength })
      }

      const id = randomUUID()
      const target = join(mediaDir, storedName(id, mime))

      /* 先落盘再写库：反过来的话，写库成功而落盘失败会留下一条指向空文件的记录 */
      writeFileSync(target, bytes)

      let record: MediaAssetRecord
      try {
        record = deps.media.create({
          id,
          filename,
          mime,
          byteSize: bytes.byteLength,
          /*
           * 尺寸留空：解析图片头需要图像库，本轮不引入原生依赖。
           * 前台用 CSS 约束显示尺寸，不依赖这两个字段。
           */
          width: null,
          height: null,
          now: now().toISOString(),
        })
      } catch (error) {
        /* 写库失败要把已落盘的文件删掉，否则会积攒无主文件 */
        rmSync(target, { force: true })
        throw error
      }

      audit('media.upload', actor, { mediaId: id, filename, byteSize: bytes.byteLength, mime })
      return toAsset(record)
    },

    list(page, pageSize) {
      const safePage = Math.max(1, Math.trunc(page))
      const safeSize = Math.min(60, Math.max(1, Math.trunc(pageSize)))
      const { items, total } = deps.media.list(safeSize, (safePage - 1) * safeSize)
      return { items: items.map(toAsset), total, page: safePage, pageSize: safeSize }
    },

    resolveFile(id) {
      /*
       * **先查库再用库里的 mime 推路径** —— 于是不存在的 id 直接 404，
       * 路径穿越在结构上不可能（见文件头第 2 条）。
       */
      const record = deps.media.getById(id)
      if (!record) throw new AppError('NOT_FOUND', { resource: 'media' })
      return { absolutePath: join(mediaDir, storedName(record.id, record.mime)), asset: toAsset(record) }
    },

    remove(id, actor) {
      const record = deps.media.getById(id)
      if (!record) throw new AppError('NOT_FOUND', { resource: 'media' })

      const references = deps.media.countReferences(id)
      if (references > 0) {
        /* 见文件头第 3 条：宁可让用户先解绑，也不要造出一堆前台 404 */
        throw new AppError('CONFLICT', { reason: 'still_referenced', references })
      }

      deps.media.delete(id)
      /* 删文件失败不报错：库里已经没了，残留文件不影响正确性（可由清理任务回收） */
      rmSync(join(mediaDir, storedName(record.id, record.mime)), { force: true })
      audit('media.delete', actor, { mediaId: id, filename: record.filename })
    },
  }
}

/*
 * 已知缺口（本轮有意不做，写在这里以免被当成疏忽）：
 *
 * · **不做图片压缩与缩略图**。原图直出，10MB 上限。后果是前台首屏可能很重，
 *   而外贸站对首屏敏感（索引 §4 的 PERF 面）。补法：引入 sharp 生成多档尺寸，
 *   或在上传时要求前端预压缩。
 * · **`width` / `height` 恒为 null**。解析图片头需要图像库。前台必须用 CSS
 *   固定容器比例，否则图片加载时会引起布局跳动（CLS 会拉低搜索排名）。
 * · **不做对象存储抽象**。文件在本地磁盘，多实例部署时不可用 ——
 *   换 S3/OSS 时只需改本文件的落盘与读取两处。
 */

/** 供测试与排查使用：读回一个已上传文件的字节数。 */
export function statUpload(mediaDir: string, record: MediaAssetRecord): number {
  return readFileSync(join(resolve(mediaDir), storedName(record.id, record.mime))).byteLength
}
