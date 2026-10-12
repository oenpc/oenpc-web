/**
 * 界面文案（`N` 层）—— **不硬编码在组件里**（硬约束 `no-hardcoded-copy`）。
 *
 * spike 阶段先用一个最小的静态映射，不强引 `vue-i18n`：
 * 本阶段要验证的是预渲染管线，不是 i18n 库的选型。
 * P1.2 会把它换成按域拆分的资源文件，但**调用形态不变**（组件里始终是 `messages.xxx`）。
 */

import type { LocaleCode } from '@oenpc-web/shared'

export interface Messages {
  siteName: string
  navHome: string
  navProducts: string
  productsTitle: string
  emptyProducts: string
  notFound: string
  viewDetail: string
  buyNow: string
  specs: string
}

export const MESSAGES: Record<LocaleCode, Messages> = {
  zh: {
    siteName: '示例外贸',
    navHome: '首页',
    navProducts: '产品中心',
    productsTitle: '产品中心',
    emptyProducts: '暂无产品',
    notFound: '页面不存在',
    viewDetail: '查看详情',
    buyNow: '前往购买',
    specs: '规格参数',
  },
  en: {
    siteName: 'Example Trading',
    navHome: 'Home',
    navProducts: 'Products',
    productsTitle: 'Products',
    emptyProducts: 'No products yet',
    notFound: 'Page not found',
    viewDetail: 'View details',
    buyNow: 'Buy now',
    specs: 'Specifications',
  },
  es: {
    siteName: 'Ejemplo Comercio',
    navHome: 'Inicio',
    navProducts: 'Productos',
    productsTitle: 'Productos',
    emptyProducts: 'Sin productos',
    notFound: 'Página no encontrada',
    viewDetail: 'Ver detalles',
    buyNow: 'Comprar',
    specs: 'Especificaciones',
  },
}

export function messagesFor(locale: LocaleCode): Messages {
  return MESSAGES[locale]
}
