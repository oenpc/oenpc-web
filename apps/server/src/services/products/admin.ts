/**
 * 产品的**后台**服务（PD 域）—— 校验、写入、审计。
 *
 * ## 为什么单独成文件，而不是塞进 `service.ts`
 *
 * `service.ts` 是**公开站点**的读路径（强制 `publishedOnly`），
 * 这里是**后台**的写路径。两者的访问策略**正好相反**，混在一起时
 * 最容易发生的错误是"某天公开接口复用了后台的某个函数"。
 * 分开之后，"公开能看到什么"只由 `service.ts` 决定，一眼可查。
 *
 * ## 校验放在服务层，不放路由层
 *
 * 路由层只校验**入参格式**（是不是整数、有没有超长）。内容层面的规则
 * （slug 形态、至少一个语种、URL 协议）属于应用策略，放这里。
 * 这样将来加"批量导入"时，导入路径能复用同一套校验，而不会各写一份。
 */

import { randomUUID } from 'node:crypto'
import type {
  AdminProductSummary,
  LocaleCode,
  Page,
  Product,
  ProductInput,
  ProductTranslationInput,
} from '@oenpc-web/shared'
import { isPurchasePlatform, SUPPORTED_LOCALES } from '@oenpc-web/shared'
import { AppError } from '../../core/errors.js'
import type { AuditRepository } from '../../repositories/audit/port.js'
import type { ProductRepository } from '../../repositories/products/port.js'

export interface AdminActor {
  id: string
  name: string
}

export interface ProductAdminServiceDeps {
  products: ProductRepository
  audit: AuditRepository
  /** 校验媒体 id 是否存在 —— 注入而不是直接依赖媒体仓储，避免两个域互相耦合。 */
  mediaExists: (id: string) => boolean
  now?: () => Date
}

export interface ProductAdminService {
  list(page: number, pageSize: number): Page<AdminProductSummary>
  create(input: ProductInput, actor: AdminActor): Product
  update(id: string, input: ProductInput, actor: AdminActor): Product
  setPublished(id: string, published: boolean, actor: AdminActor): void
  remove(id: string, actor: AdminActor): void
}

/**
 * slug 形态：小写字母 / 数字 / 单连字符分段。
 *
 * 限制它不是为了美观 —— slug 会直接进 URL。含空格、大写、中文的 slug
 * 会被浏览器编码成 `%E9%92%A2%E7%AE%A1` 这类不可读形式，
 * 而**搜索引擎对可读 URL 的偏好是实打实的**。
 */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const MAX_NAME_LENGTH = 200
const MAX_SUMMARY_LENGTH = 500
const MAX_DESCRIPTION_LENGTH = 20000
const MAX_SPECS = 50
const MAX_MEDIA = 30
const MAX_CHANNELS = 20

function fail(field: string, reason: string, extra: Record<string, string | number> = {}): never {
  throw new AppError('BAD_REQUEST', { field, reason, ...extra })
}

function validateTranslation(locale: string, input: ProductTranslationInput): void {
  const slug = input.slug.trim()
  const name = input.name.trim()

  if (slug === '') fail(`translations.${locale}.slug`, 'required')
  if (!SLUG_PATTERN.test(slug)) {
    fail(`translations.${locale}.slug`, 'invalid_format', { hint: '只允许小写字母、数字与单连字符' })
  }
  if (name === '') fail(`translations.${locale}.name`, 'required')
  if (name.length > MAX_NAME_LENGTH) fail(`translations.${locale}.name`, 'too_long', { max: MAX_NAME_LENGTH })
  if (input.summary.length > MAX_SUMMARY_LENGTH) {
    fail(`translations.${locale}.summary`, 'too_long', { max: MAX_SUMMARY_LENGTH })
  }
  if (input.description.length > MAX_DESCRIPTION_LENGTH) {
    fail(`translations.${locale}.description`, 'too_long', { max: MAX_DESCRIPTION_LENGTH })
  }
}

/**
 * 校验并**归一化**入参（去空白、补默认）。
 *
 * @returns 可直接落库的 `ProductInput`
 */
export function validateProductInput(raw: ProductInput): ProductInput {
  const translations: Partial<Record<LocaleCode, ProductTranslationInput>> = {}

  for (const locale of SUPPORTED_LOCALES) {
    const entry = raw.translations[locale]
    if (!entry) continue
    /* 只填了空白字符的语种视为"没填"，避免产生一个看似存在实则空白的页面 */
    if (entry.slug.trim() === '' && entry.name.trim() === '') continue

    validateTranslation(locale, entry)
    translations[locale] = {
      slug: entry.slug.trim(),
      name: entry.name.trim(),
      summary: entry.summary.trim(),
      description: entry.description.trim(),
    }
  }

  if (Object.keys(translations).length === 0) {
    /*
     * 一个没有任何语种内容的产品，前台既访问不到也无法索引 ——
     * 它只会在后台列表里占一行，让运营者以为"加了产品但站点上没有"。
     */
    fail('translations', 'at_least_one_locale_required', { locales: SUPPORTED_LOCALES.join(', ') })
  }

  if (raw.specs.length > MAX_SPECS) fail('specs', 'too_many', { max: MAX_SPECS })
  if (raw.mediaIds.length > MAX_MEDIA) fail('mediaIds', 'too_many', { max: MAX_MEDIA })
  if (raw.channels.length > MAX_CHANNELS) fail('channels', 'too_many', { max: MAX_CHANNELS })

  const channels = raw.channels.map((channel, index) => {
    if (!isPurchasePlatform(channel.platform)) {
      fail(`channels.${index}.platform`, 'unknown_platform', { value: String(channel.platform) })
    }
    if (!/^https?:\/\//i.test(channel.url)) {
      fail(`channels.${index}.url`, 'must_be_http_url')
    }
    return { ...channel, url: channel.url.trim(), sortOrder: channel.sortOrder ?? index }
  })

  /* 去重：同一个媒体重复出现在图集里没有意义，而且会撞关联表主键 */
  const mediaIds = [...new Set(raw.mediaIds)]

  return {
    translations,
    categoryId: raw.categoryId,
    coverMediaId: raw.coverMediaId,
    mediaIds,
    specs: raw.specs.map((spec) => ({
      key: Object.fromEntries(Object.entries(spec.key).map(([k, v]) => [k, (v ?? '').trim()])),
      value: Object.fromEntries(Object.entries(spec.value).map(([k, v]) => [k, (v ?? '').trim()])),
    })),
    channels,
    published: raw.published,
    sortOrder: Number.isFinite(raw.sortOrder) ? Math.trunc(raw.sortOrder) : 0,
  }
}

export function createProductAdminService(deps: ProductAdminServiceDeps): ProductAdminService {
  const now = deps.now ?? (() => new Date())

  function audit(
    action: string,
    actor: AdminActor,
    objectId: string,
    detail?: Record<string, unknown>,
  ): void {
    try {
      deps.audit.append({
        id: randomUUID(),
        actorId: actor.id,
        actorName: actor.name,
        action,
        objectType: 'product',
        objectId,
        now: now().toISOString(),
        ...(detail ? { detail } : {}),
      })
    } catch (error) {
      console.error('[audit] 写入失败（已忽略，不影响业务）：', error)
    }
  }

  /** 引用的媒体必须真的存在，否则会留下指向空图片的产品（前台渲染出破图）。 */
  function assertMediaExists(input: ProductInput): void {
    const referenced = [input.coverMediaId, ...input.mediaIds].filter(
      (id): id is string => typeof id === 'string' && id !== '',
    )
    for (const id of referenced) {
      if (!deps.mediaExists(id)) fail('mediaIds', 'media_not_found', { mediaId: id })
    }
  }

  return {
    list(page, pageSize) {
      return deps.products.listForAdmin(page, pageSize)
    },

    create(rawInput, actor) {
      const input = validateProductInput(rawInput)
      assertMediaExists(input)

      const result = deps.products.create(input, randomUUID(), now().toISOString())
      if ('conflict' in result) {
        /* slug 冲突是**用户可修正的**错误，所以是 400 而不是 500 */
        throw new AppError('BAD_REQUEST', { field: 'translations', reason: 'slug_conflict', detail: result.conflict })
      }

      audit('product.create', actor, result.id, { locales: Object.keys(input.translations) })
      return result
    },

    update(id, rawInput, actor) {
      const input = validateProductInput(rawInput)
      assertMediaExists(input)

      const result = deps.products.update(id, input, now().toISOString())
      if (result === null) throw new AppError('NOT_FOUND', { resource: 'product' })
      if ('conflict' in result) {
        throw new AppError('BAD_REQUEST', { field: 'translations', reason: 'slug_conflict', detail: result.conflict })
      }

      audit('product.update', actor, id, { locales: Object.keys(input.translations) })
      return result
    },

    setPublished(id, published, actor) {
      if (!deps.products.setPublished(id, published, now().toISOString())) {
        throw new AppError('NOT_FOUND', { resource: 'product' })
      }
      audit(published ? 'product.publish' : 'product.unpublish', actor, id)
    },

    remove(id, actor) {
      /* 先取出快照再删 —— 删完就查不到 name 了，而审计里应当留下"删的是哪个产品" */
      const snapshot = deps.products.getById(id)
      if (!snapshot) throw new AppError('NOT_FOUND', { resource: 'product' })

      deps.products.remove(id)
      audit('product.delete', actor, id, { name: snapshot.name })
    },
  }
}
