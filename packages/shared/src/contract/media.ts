/**
 * 媒体契约（MD 域）。
 *
 * ## `url` 是**相对路径**，不是绝对地址
 *
 * 前台站点与 API 在部署上是**同源反代**（A 机 nginx 把 `/media/` 转给 B 机），
 * 所以 `/media/<id>` 这样的相对路径在两种环境里都对。
 * 若返回绝对 URL，就得把站点域名写进数据库 —— 那么换域名或本地调试时，
 * 所有历史图片地址全会失效，而这类数据迁移非常痛。
 */

export interface MediaAsset {
  id: string
  /** 上传时的原始文件名 —— 仅用于**展示与下载命名**，不参与磁盘路径。 */
  filename: string
  mime: string
  byteSize: number
  /** 图片尺寸。非图片或未能解析时为 null。 */
  width: number | null
  height: number | null
  createdAt: string
  /** 可直接用于 `<img src>` 的相对路径。 */
  url: string
}

/** 上传结果的形状与 MediaAsset 相同 —— 客户端拿到就能直接渲染。 */
export type MediaUploadResult = MediaAsset
