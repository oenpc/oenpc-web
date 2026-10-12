/**
 * `@oenpc-web/shared` —— 前后端契约的**唯一权威**。
 *
 * ## 这个包只放两样东西
 *
 * 1. **类型**（interface / type）
 * 2. **封闭枚举常量**（`as const` 数组 + 派生联合类型）
 *
 * **不放运行时逻辑** —— 没有函数实现、没有数据库访问、没有 HTTP 调用。
 * 判断标准：把这里的代码删掉，前后端**都不该改变行为**，只该报类型错。
 *
 * > 例外说明：`isSupportedLocale` / `isPermission` 这类**纯判定函数**在这里，
 * > 因为它们是"枚举的伴生谓词"，与枚举必须同源。
 * > 但它们必须是**纯函数**——不读环境、不做 IO。
 *
 * ## 为什么不各端写一份
 *
 * 两份类型定义会漂移，而漂移的症状是"运行时字段对不上"——
 * 前端按 `coverMediaId` 取，后端返回 `coverId`，页面上图片全是空的，
 * 但类型检查两边都过（硬约束 `shared-contract`）。
 *
 * 导入路径带 `.js` 后缀：`moduleResolution: NodeNext`（server）要求显式扩展名，
 * 而 `Bundler`（前端）也接受这种写法 —— 两边都能解析。
 */

export * from './error-codes.js'
export * from './envelope.js'
export * from './locales.js'
export * from './permissions.js'
export * from './contract/auth.js'
export * from './contract/channels.js'
export * from './contract/media.js'
export * from './contract/products.js'
