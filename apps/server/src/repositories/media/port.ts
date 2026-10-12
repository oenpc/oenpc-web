/**
 * 媒体库的**端口**（MD 域）。
 *
 * ## 关于磁盘文件名的约定（没有 `stored_name` 列的原因）
 *
 * 文件按 `<id><扩展名>` 存放，扩展名由 **mime 反查**得出，不采信上传时的原始文件名。
 * 理由：
 *   · 原始文件名可能含 `../`、空字节、超长串 —— 直接用它做路径是目录穿越的经典入口；
 *   · `mime → 扩展名` 的映射是稳定的（`image/jpeg → .jpg` 不会变），
 *     所以可以由 `id + mime` **确定性地重建**路径，不必额外存一列。
 *
 * 代价：若将来改了这张映射表，老文件的扩展名要与新表一致。
 * 判断是"可接受"——映射表只会**增加**条目，不会改动已有条目。
 *
 * `filename` 仍然存进库，但**只用于展示与下载命名**，永不参与磁盘路径拼装。
 */

export interface MediaAssetRecord {
  id: string
  filename: string
  mime: string
  byteSize: number
  width: number | null
  height: number | null
  createdAt: string
}

export interface CreateMediaInput {
  id: string
  filename: string
  mime: string
  byteSize: number
  width: number | null
  height: number | null
  now: string
}

export interface MediaRepository {
  create(input: CreateMediaInput): MediaAssetRecord
  getById(id: string): MediaAssetRecord | null
  list(limit: number, offset: number): { items: MediaAssetRecord[]; total: number }
  delete(id: string): void
  /**
   * 引用计数：该媒体被多少个产品引用（封面 + 图集）。
   *
   * 删除媒体前**必须**查它 —— 否则删掉仍被产品引用的图片会让前台直接 404，
   * 而那个 404 出现在产品页上，看起来像"图片丢了"，不像是"有人在媒体库里删了东西"。
   */
  countReferences(id: string): number
}
