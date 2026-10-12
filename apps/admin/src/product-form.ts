/*
 * `Product`（读）↔ `ProductInput`（写）的转换。
 *
 * ## 为什么必须有这个文件
 *
 * 读接口返回的 `Product` 把多语文本展开成 `LocalizedText`（`name: { en, zh, es }`），
 * 而写接口接收的 `ProductInput` 是**按语种分组**的
 * （`translations: { en: { slug, name, ... } }`）。
 *
 * 两种形状都是有意的：读形状便于渲染，写形状便于校验"某个语种是否完整"。
 * 但它们不同这一点很容易被忽略 —— 直接把读到的对象丢回写接口，
 * 结果是**所有翻译字段被静默清空**（因为 `translations` 缺失，服务端会报
 * "至少一个语种必填"，但若恰好传了个空对象，产品就变成空的了）。
 *
 * 所以转换只在这一个文件里发生，两个视图共用。
 */

import {
  SUPPORTED_LOCALES,
  type LocaleCode,
  type Product,
  type ProductInput,
  type ProductTranslationInput,
} from '@oenpc-web/shared'

export type TranslationForm = ProductTranslationInput

export function emptyTranslations(): Record<string, TranslationForm> {
  const result: Record<string, TranslationForm> = {}
  for (const locale of SUPPORTED_LOCALES) {
    result[locale] = { slug: '', name: '', summary: '', description: '' }
  }
  return result
}

/** 取出某语种的可填内容；缺失时给空表单（**不回落**到别的语种）。 */
export function translationOf(product: Product | null, locale: LocaleCode): TranslationForm {
  if (!product) return { slug: '', name: '', summary: '', description: '' }
  return {
    slug: product.slug[locale] ?? '',
    name: product.name[locale] ?? '',
    summary: product.summary[locale] ?? '',
    description: product.description[locale] ?? '',
  }
}

/**
 * 读形状 → 写形状。
 *
 * **原样保留 `specs`**：当前后台没有规格编辑器，而更新是"整份替换"——
 * 不带上就等于把已有规格删掉。这是全替换语义下最容易造成数据丢失的地方。
 */
export function productToInput(product: Product): ProductInput {
  /*
   * 按**全部受支持语种**逐一组装，缺哪个语种就不提交哪个 ——
   * 读形状是 `LocalizedText`（可能有 1~3 个键），写形状需要按语种分组，
   * 所以这里必须显式遍历，不能只取一个语种。
   */
  const translations: ProductInput['translations'] = {}
  for (const locale of SUPPORTED_LOCALES) {
    const form = translationOf(product, locale)
    if (form.slug === '' && form.name === '') continue
    translations[locale] = form
  }

  return {
    translations,
    categoryId: product.categoryId,
    coverMediaId: product.coverMediaId,
    mediaIds: [...product.mediaIds],
    specs: product.specs,
    channels: product.channels.map((channel) => ({
      platform: channel.platform,
      url: channel.url,
      ...(channel.label ? { label: channel.label } : {}),
      sortOrder: channel.sortOrder,
    })),
    published: product.published,
    sortOrder: product.sortOrder,
  }
}

/** 把按语种分组的表单转成 `LocalizedText` 记录（提交前用）。 */
export function toProductInput(state: {
  translations: Record<string, TranslationForm>
  categoryId: string | null
  coverMediaId: string | null
  mediaIds: string[]
  specs: ProductInput['specs']
  channels: ProductInput['channels']
  published: boolean
  sortOrder: number
}): ProductInput {
  /*
   * 只提交**填了内容**的语种：全空白的语种若也提交，
   * 服务端的 slug 形态校验会报错，而用户看到的是"我什么都没填却报 slug 非法"。
   * 服务端也会再过滤一次（两边都做，是因为任一侧漏了都会产生难懂的错误）。
   */
  const translations: ProductInput['translations'] = {}
  for (const [locale, form] of Object.entries(state.translations)) {
    if (form.slug.trim() === '' && form.name.trim() === '') continue
    translations[locale as LocaleCode] = {
      slug: form.slug.trim(),
      name: form.name.trim(),
      summary: form.summary.trim(),
      description: form.description.trim(),
    }
  }

  return {
    translations,
    categoryId: state.categoryId,
    coverMediaId: state.coverMediaId,
    mediaIds: state.mediaIds,
    specs: state.specs,
    channels: state.channels,
    published: state.published,
    sortOrder: state.sortOrder,
  }
}
