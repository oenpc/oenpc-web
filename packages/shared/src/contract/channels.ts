/**
 * 购买渠道（CH 域）—— 挂在产品上的第三方平台链接。
 *
 * ## 为什么平台必须是封闭枚举（功能清单 F3.2）
 *
 * 前台要为每个渠道渲染平台图标与按钮样式。如果平台是自由文本，
 * 运营者写「阿里巴巴」「阿里国际站」「Alibaba」会被当成三个平台 ——
 * 图标缺失、样式不统一，而且统计（F15.2 出站点击）会碎成几十个键。
 * **运营者输入的自由度，必须由枚举收紧。**
 *
 * ## 为什么 `url` 不做服务端拼接
 *
 * 平台链接形态各异（有的带商品 id 路径、有的走短链），服务端拼不出来。
 * 服务端只校验 `http(s)://` 协议与长度，**不猜**平台 URL 规则。
 */

import type { LocalizedText } from '../locales.js'

export const PURCHASE_PLATFORMS = [
  'alibaba',
  'made-in-china',
  'aliexpress',
  'amazon',
  'shopify',
  'whatsapp',
  'other',
] as const

export type PurchasePlatform = (typeof PURCHASE_PLATFORMS)[number]

export interface PurchaseChannelLink {
  id: string
  platform: PurchasePlatform
  /** 必须是 http(s) 绝对地址；前台跳转一律加 rel="noopener noreferrer"。 */
  url: string
  sortOrder: number
  /** 可选的自定义按钮文案（多语）。为空时用平台默认文案。 */
  label?: LocalizedText
}

/** 是否受支持的平台 —— 用于后台保存前的校验。 */
export function isPurchasePlatform(value: string): value is PurchasePlatform {
  return (PURCHASE_PLATFORMS as readonly string[]).includes(value)
}
