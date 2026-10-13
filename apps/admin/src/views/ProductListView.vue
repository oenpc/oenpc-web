<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  PUBLIC_DEFAULT_LOCALE,
  type AdminProductSummary,
  type MediaAsset,
  type Page,
  type Product,
} from '@oenpc-web/shared'
import { useDialog } from 'naive-ui'
import { ApiError, api } from '../api'
import { productToInput } from '../product-form'
import MediaPicker from '../components/MediaPicker.vue'

/* 本组件在 App.vue 的 provider 子树里（它是路由页面），所以这里能取到实例 */
const dialog = useDialog()

const list = ref<AdminProductSummary[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const loading = ref(true)
const error = ref('')
const notice = ref('')

/** 正在为哪个产品挑封面（null = 没在挑）。存对象而不是 id，省掉一次查找与断言。 */
const pickerTarget = ref<AdminProductSummary | null>(null)

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))

/*
 * 列表以**默认语种**的名称为主标题，并显式标出缺哪些语种 ——
 * 只看一种语言时最容易发生的是"英文录了、中文忘了"，
 * 而那在前台表现为中文页面不存在，当场很难发现。
 */
function titleOf(item: AdminProductSummary): string {
  return item.name[PUBLIC_DEFAULT_LOCALE] ?? Object.values(item.name)[0] ?? item.id
}

function missingLocales(item: AdminProductSummary): string[] {
  return Object.entries(item.name)
    .filter(([, value]) => !value)
    .map(([locale]) => locale)
}

function messageFor(thrown: unknown): string {
  if (thrown instanceof ApiError) {
    if (thrown.code === 'FORBIDDEN') return '当前账号没有该操作的权限'
    if (thrown.code === 'NOT_FOUND') return '该产品已不存在，可能已被其他人删除'
    if (thrown.code === 'CONFLICT') return '存在引用关系，无法删除'
    return `操作失败（${thrown.code}）`
  }
  return '网络异常，请稍后重试'
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const result = await api.get<Page<AdminProductSummary>>(
      `/api/admin/products?page=${page.value}&pageSize=${pageSize}`,
    )
    list.value = result.items
    total.value = result.total
  } catch (thrown) {
    error.value = messageFor(thrown)
  } finally {
    loading.value = false
  }
}

async function togglePublished(item: AdminProductSummary): Promise<void> {
  error.value = ''
  notice.value = ''
  try {
    await api.post(`/api/admin/products/${item.id}/published`, { published: !item.published })
    notice.value = item.published ? '已下架（前台将不再显示）' : '已上架'
    await load()
  } catch (thrown) {
    error.value = messageFor(thrown)
  }
}

/*
 * 删除不可逆（产品与翻译、图集、渠道一并级联删除）。
 *
 * 用 useDialog 而不是原生弹窗：原生弹窗阻塞主线程、自动化测试驱动不了它、
 * 文案不跟主题走也无法本地化 —— 这条已固化为约束 no-window-modal。
 *
 * 请求放在 `onPositiveClick` 里而不是"确认后另起一段"：
 * 返回 Promise 时对话框会一直保持 loading 到它落定，
 * 用户因此没有机会在请求进行中重复点"删除"。
 */
function remove(item: AdminProductSummary): void {
  dialog.warning({
    title: '删除产品',
    content: `确定删除「${titleOf(item)}」？该操作不可撤销。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: () => performRemove(item),
  })
}

async function performRemove(item: AdminProductSummary): Promise<void> {
  error.value = ''
  notice.value = ''
  try {
    await api.del(`/api/admin/products/${item.id}`)
    notice.value = '已删除'
    await load()
  } catch (thrown) {
    error.value = messageFor(thrown)
  }
}

async function onCoverPicked(asset: MediaAsset | null): Promise<void> {
  const target = pickerTarget.value
  pickerTarget.value = null
  if (!target || !asset) return

  /*
   * 只改封面也要提交**整份**产品（更新是整份替换）。
   * 先取完整产品 → 经 `productToInput` 转成写形状 → 改一个字段再提交。
   * 直接构造一个只含封面的 body 会把其他字段全部清空。
   */
  error.value = ''
  try {
    const product = await api.get<Product>(`/api/admin/products/${target.id}`)
    await api.put(`/api/admin/products/${target.id}`, {
      ...productToInput(product),
      coverMediaId: asset.id,
    })
    notice.value = '已设置封面'
    await load()
  } catch (thrown) {
    error.value = messageFor(thrown)
  }
}

onMounted(load)
</script>

<template>
  <h1>产品</h1>

  <p v-if="error" class="alert alert-error">{{ error }}</p>
  <p v-else-if="notice" class="alert alert-ok">{{ notice }}</p>

  <div class="card">
    <div style="display: flex; align-items: center; margin-bottom: 12px">
      <span class="muted">共 {{ total }} 个产品</span>
      <span style="flex: 1" />
      <RouterLink class="btn" :to="{ name: 'product-new' }" style="text-decoration: none">
        新建产品
      </RouterLink>
    </div>

    <p v-if="loading" class="muted">加载中…</p>

    <p v-else-if="list.length === 0" class="alert alert-warn">
      还没有产品。点右上角「新建产品」开始 ——
      <strong>未上架的产品不会出现在前台站点</strong>，建好后记得点「上架」。
    </p>

    <table v-else>
      <thead>
        <tr>
          <th>名称</th>
          <th style="width: 90px">状态</th>
          <th style="width: 200px">语种</th>
          <th style="width: 150px">更新时间</th>
          <th style="width: 250px">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in list" :key="item.id">
          <td>
            <RouterLink :to="{ name: 'product-edit', params: { id: item.id } }">
              {{ titleOf(item) }}
            </RouterLink>
          </td>
          <td>
            <span class="badge" :class="item.published ? 'badge-on' : 'badge-off'">
              {{ item.published ? '已上架' : '未上架' }}
            </span>
          </td>
          <td>
            <span class="muted">{{ Object.keys(item.name).join(' / ') || '（无）' }}</span>
            <span v-if="missingLocales(item).length > 0" class="muted">
              · 缺 {{ missingLocales(item).join('/') }}
            </span>
          </td>
          <td class="muted">{{ item.updatedAt.replace('T', ' ').slice(0, 16) }}</td>
          <td>
            <button class="btn btn-ghost btn-small" type="button" @click="togglePublished(item)">
              {{ item.published ? '下架' : '上架' }}
            </button>
            <button class="btn btn-ghost btn-small" type="button" @click="pickerTarget = item">
              设封面
            </button>
            <button class="btn btn-danger btn-small" type="button" @click="remove(item)">删除</button>
          </td>
        </tr>
      </tbody>
    </table>

    <div v-if="totalPages > 1" style="margin-top: 12px; display: flex; gap: 8px; align-items: center">
      <button
        class="btn btn-ghost btn-small"
        type="button"
        :disabled="page <= 1"
        @click="page -= 1; void load()"
      >
        上一页
      </button>
      <span class="muted">{{ page }} / {{ totalPages }}</span>
      <button
        class="btn btn-ghost btn-small"
        type="button"
        :disabled="page >= totalPages"
        @click="page += 1; void load()"
      >
        下一页
      </button>
    </div>
  </div>

  <MediaPicker
    v-if="pickerTarget"
    :multiple="false"
    @picked="onCoverPicked"
    @close="pickerTarget = null"
  />
</template>
