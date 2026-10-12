<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  PUBLIC_DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  type LocaleCode,
  type MediaAsset,
  type Product,
  type ProductInput,
  type PurchasePlatform,
  type PurchaseChannelInput,
} from '@oenpc-web/shared'
import { PURCHASE_PLATFORMS } from '@oenpc-web/shared'
import { ApiError, api } from '../api'
import { emptyTranslations, toProductInput, translationOf, type TranslationForm } from '../product-form'
import MediaPicker from '../components/MediaPicker.vue'

const route = useRoute()
const router = useRouter()

const id = computed(() => (typeof route.params.id === 'string' ? route.params.id : null))
const isNew = computed(() => id.value === null)

const activeLocale = ref<LocaleCode>(PUBLIC_DEFAULT_LOCALE)
const translations = reactive<Record<string, TranslationForm>>(emptyTranslations())
const published = ref(false)
const sortOrder = ref(0)
const coverMediaId = ref<string | null>(null)
const mediaIds = ref<string[]>([])
const channels = ref<PurchaseChannelInput[]>([])

const loading = ref(true)
const saving = ref(false)
const error = ref('')

const picker = ref<'cover' | 'gallery' | null>(null)

/*
 * ★ 保存时**必须**把 UI 不编辑的字段原样带回去。
 *   更新是"整份替换"（见契约里的 ProductInput 说明），漏带就等于删除。
 *   当前没有规格编辑器，所以 `specs` 只能原样回传。
 *   这一类数据丢失是静默的：保存成功、页面正常，几分钟后才发现规格没了。
 */
let preservedSpecs: ProductInput['specs'] = []
let preservedCategoryId: string | null = null

function messageFor(thrown: unknown): string {
  if (thrown instanceof ApiError) {
    if (thrown.code === 'BAD_REQUEST') {
      const field = thrown.meta?.field
      const reason = thrown.meta?.reason
      if (reason === 'slug_conflict') return String(thrown.meta?.detail ?? 'slug 已被占用')
      if (reason === 'at_least_one_locale_required') return '至少要填写一个语种的 slug 与名称'
      if (reason === 'invalid_format') return `${String(field)} 格式不对：只允许小写字母、数字与单连字符`
      if (reason === 'required') return `${String(field)} 不能为空`
      if (reason === 'media_not_found') return '引用的图片不存在，请重新选择'
      return `参数有误：${String(field ?? '')}`
    }
    if (thrown.code === 'FORBIDDEN') return '当前账号没有该操作的权限'
    return `保存失败（${thrown.code}）`
  }
  return '网络异常，请稍后重试'
}

async function load(): Promise<void> {
  loading.value = true
  try {
    if (id.value === null) return
    const product = await api.get<Product>(`/api/admin/products/${id.value}`)

    for (const locale of SUPPORTED_LOCALES) {
      translations[locale] = translationOf(product, locale)
    }
    published.value = product.published
    sortOrder.value = product.sortOrder
    coverMediaId.value = product.coverMediaId
    mediaIds.value = [...product.mediaIds]
    channels.value = product.channels.map((channel) => ({
      platform: channel.platform,
      url: channel.url,
      ...(channel.label ? { label: channel.label } : {}),
      sortOrder: channel.sortOrder,
    }))
    preservedSpecs = product.specs
    preservedCategoryId = product.categoryId
  } catch (thrown) {
    error.value = messageFor(thrown)
  } finally {
    loading.value = false
  }
}

async function save(): Promise<void> {
  if (saving.value) return
  saving.value = true
  error.value = ''

  try {
    const payload = toProductInput({
      translations,
      categoryId: preservedCategoryId,
      coverMediaId: coverMediaId.value,
      mediaIds: mediaIds.value,
      specs: preservedSpecs,
      channels: channels.value,
      published: published.value,
      sortOrder: sortOrder.value,
    })

    if (id.value === null) {
      await api.post('/api/admin/products', payload)
    } else {
      await api.put(`/api/admin/products/${id.value}`, payload)
    }
    await router.push({ name: 'products' })
  } catch (thrown) {
    error.value = messageFor(thrown)
  } finally {
    saving.value = false
  }
}

function addChannel(): void {
  channels.value = [...channels.value, { platform: 'alibaba', url: '', sortOrder: channels.value.length }]
}

function removeChannel(index: number): void {
  channels.value = channels.value.filter((_, i) => i !== index)
}

function onPicked(asset: MediaAsset | MediaAsset[]): void {
  if (Array.isArray(asset)) {
    mediaIds.value = asset.map((item) => item.id)
  } else {
    coverMediaId.value = asset.id
  }
  picker.value = null
}

onMounted(load)
</script>

<template>
  <h1>{{ isNew ? '新建产品' : '编辑产品' }}</h1>

  <p v-if="error" class="alert alert-error">{{ error }}</p>
  <p v-if="loading" class="muted">加载中…</p>

  <template v-else>
    <div class="card">
      <h2>多语内容</h2>
      <p class="muted" style="margin-top: 0">
        <strong>每个语种是独立的页面与独立的 URL。</strong>
        只填了部分语种时，未填的语种不会生成页面 —— 前台语言切换会退回该语种首页。
      </p>

      <div class="locale-tabs">
        <button
          v-for="locale in SUPPORTED_LOCALES"
          :key="locale"
          type="button"
          :class="{ active: locale === activeLocale }"
          @click="activeLocale = locale"
        >
          {{ locale }}
          <span v-if="translations[locale]?.name?.trim()">·</span>
        </button>
      </div>

      <div class="field">
        <label :for="`slug-${activeLocale}`">slug（进入 URL，小写字母/数字/连字符）</label>
        <input :id="`slug-${activeLocale}`" v-model="translations[activeLocale].slug" type="text" />
        <p class="muted" style="margin: 4px 0 0">
          最终地址形如 /{{ activeLocale }}/products/{{ translations[activeLocale].slug || 'your-slug' }}
        </p>
      </div>

      <div class="field">
        <label :for="`name-${activeLocale}`">名称</label>
        <input :id="`name-${activeLocale}`" v-model="translations[activeLocale].name" type="text" />
      </div>

      <div class="field">
        <label :for="`summary-${activeLocale}`">摘要（列表页显示）</label>
        <input :id="`summary-${activeLocale}`" v-model="translations[activeLocale].summary" type="text" />
      </div>

      <div class="field">
        <label :for="`desc-${activeLocale}`">详细描述</label>
        <textarea :id="`desc-${activeLocale}`" v-model="translations[activeLocale].description" />
      </div>
    </div>

    <div class="card">
      <h2>图片</h2>
      <div class="row">
        <div>
          <label>封面图</label>
          <div v-if="coverMediaId" class="media-item" style="max-width: 160px">
            <img :src="`/media/${coverMediaId}`" alt="cover" />
            <div style="padding: 4px 6px">
              <button class="btn btn-ghost btn-small" type="button" @click="coverMediaId = null">
                清除
              </button>
            </div>
          </div>
          <button v-else class="btn btn-ghost" type="button" @click="picker = 'cover'">选择封面</button>
        </div>
        <div>
          <label>图集（已选 {{ mediaIds.length }} 张）</label>
          <button class="btn btn-ghost" type="button" @click="picker = 'gallery'">选择图集</button>
          <p v-if="mediaIds.length > 0" class="muted" style="margin-top: 6px">
            顺序即前台展示顺序（当前按选择顺序）
          </p>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>购买渠道</h2>
      <p class="muted" style="margin-top: 0">
        第三方平台链接（阿里国际站 / 亚马逊等）。前台按下面的顺序展示为「前往购买」按钮。
      </p>

      <div v-for="(channel, index) in channels" :key="index" class="row" style="margin-bottom: 8px">
        <select v-model="channel.platform" style="max-width: 180px">
          <option v-for="platform in PURCHASE_PLATFORMS" :key="platform" :value="platform">
            {{ platform }}
          </option>
        </select>
        <input v-model="channel.url" type="url" placeholder="https://..." />
        <button class="btn btn-ghost btn-small" type="button" style="max-width: 70px" @click="removeChannel(index)">
          移除
        </button>
      </div>

      <button class="btn btn-ghost btn-small" type="button" @click="addChannel">添加渠道</button>
    </div>

    <div class="card">
      <h2>发布</h2>
      <div class="row">
        <div>
          <label for="published">
            <input id="published" v-model="published" type="checkbox" style="width: auto" />
            上架（前台可见）
          </label>
          <p class="muted" style="margin: 4px 0 0">
            未上架的产品不会出现在前台列表，也不会进入 sitemap。
          </p>
        </div>
        <div>
          <label for="sort">排序值（小的在前）</label>
          <input id="sort" v-model.number="sortOrder" type="number" />
        </div>
      </div>
    </div>

    <div style="display: flex; gap: 8px">
      <button class="btn" type="button" :disabled="saving" @click="save">
        {{ saving ? '保存中…' : '保存' }}
      </button>
      <RouterLink class="btn btn-ghost" :to="{ name: 'products' }" style="text-decoration: none">
        返回列表
      </RouterLink>
    </div>

    <p class="muted" style="margin-top: 16px">
      注意：保存后前台是<strong>静态页面</strong>，需要重新构建才会更新（见部署说明的
      <code>build:web</code> 步骤）。这不代表保存失败。
    </p>
  </template>

  <MediaPicker
    v-if="picker !== null"
    :multiple="picker === 'gallery'"
    @picked="onPicked"
    @confirmed="onPicked"
    @close="picker = null"
  />
</template>
