/**
 * 语种 —— **封闭枚举，且必须 ≥3 个**。
 *
 * ## 为什么这条是硬约束（功能清单 F5.4）
 *
 * 如果只写 `zh` / `en` 两个分支，业务表就会长成 `name_zh` / `name_en` 两列；
 * 等到要加第三语种，就得改表结构 + 改遍所有读写点 + 迁移全部既有数据。
 * **这个决定必须在建表之前做，事后改的成本不可逆。**
 *
 * 所以：业务文本一律走**逐字段多语**结构（`LocalizedText`，见 contract/），
 * 而不是按语种加列。加第四、第五个语种时，只需要往下面的数组里加一项。
 *
 * ## 两个默认语种不同，是有意的
 *
 * 公开站点的第一受众是**海外采购商**，后台的第一受众是**中文运营者** ——
 * 这不是同一个"默认语言"，混成一个会在两边各错一半。
 */

export const SUPPORTED_LOCALES = ['zh', 'en', 'es'] as const

export type LocaleCode = (typeof SUPPORTED_LOCALES)[number]

/** 公开站点默认语种：外贸站的第一受众是海外采购商。 */
export const PUBLIC_DEFAULT_LOCALE: LocaleCode = 'en'

/** 后台默认语种：运营者是中文用户。 */
export const ADMIN_DEFAULT_LOCALE: LocaleCode = 'zh'

/** 语种是否受支持 —— 用于 URL 前缀与 `hreflang` 的合法性校验。 */
export function isSupportedLocale(value: string): value is LocaleCode {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

/**
 * 多语言文本：**逐字段多语**，不是一个字段里塞两种语言。
 *
 * 缺失的语种必须由**显式的回退策略**处理（见 ST 域的语种解析），
 * 不允许在仓储层静默回落到默认语种 —— 那会让"漏传语种"表现为
 * "前台显示了另一种语言"而不是报错（见索引 §4 陷阱 P-11）。
 */
export type LocalizedText = Partial<Record<LocaleCode, string>>
