<script setup lang="ts">
/*
 * 产品列表 —— 服务端分页的 n-data-table。
 *
 * ## 为什么用 n-data-table 而不是继续手写 <table>
 *
 * 手写表在"加载中 / 空 / 分页"这三个状态下要各写一套模板，而它们**都与数据无关**。
 * 用组件库后这三块由 `loading` / `#empty` / `remote` 分页三个 prop 表达，
 * 视图里剩下的就是真正的业务列定义。
 *
 * ## ⚠ 本文件的类型安全有一半是空的（必须知道）
 *
 * `vite.config.ts` 里 `Components` 插件用了 `dts: false`，所以 **`n-*` 组件的 props
 * 不被 vue-tsc 检查**：普通模板表达式有保护，但"把 `pagination` 写成 `paginate`"
 * 这类错误 typecheck 抓不到 —— 列定义写错同样抓不到（`DataTableColumns<T>` 只是我
 * 手写的注解，模板里的 `:columns` 并不做交叉校验）。所以这里的列定义是**按文档逐字核对**
 * 的，而不是"类型过了就没事"。
 */
import { computed, h, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { NButton, NTag, useDialog, type DataTableColumns } from 'naive-ui'
import {
  PUBLIC_DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  type AdminProductSummary,
  type MediaAsset,
  type Page,
  type Product,
} from '@oenpc-web/shared'
import { AddOutline } from '@vicons/ionicons5'
import { ApiError, api } from '../api'
import { productToInput } from '../product-form'
import MediaPicker from '../components/MediaPicker.vue'

/* 本组件在 App.vue 的 provider 子树里（它是路由页面），所以这里能取到实例 */
const dialog = useDialog()
const router = useRouter()

const list = ref<AdminProductSummary[]>([])
const total = ref(0)
const page = ref(1)
/*
 * 每页条数**固定**，不做选择器：服务端分页契约里 pageSize 是入参，
 * 但列表页只有几十条数据，给一个"每页 10/20/50"的选择器只会多一个要测的状态。
 * 真需要时再加 —— 那时改的也只是这一处。
 */
const PAGE_SIZE = 20
const loading = ref(true)
const error = ref('')
const notice = ref('')

/** 正在为哪个产品挑封面（null = 没在挑）。存对象而不是 id，省掉一次查找与断言。 */
const pickerTarget = ref<AdminProductSummary | null>(null)

/*
 * 名称取**公开默认语种**（`PUBLIC_DEFAULT_LOCALE`，当前是 `en`），
 * 缺失才回落到"任一存在的语种"，最后才退到 id。
 *
 * 为什么不是后台默认语种（zh）：这一列回答的是"**访客**会看到什么"。
 * 运营者习惯中文，但中文名对"前台英文页显示什么"没有参考价值 ——
 * 列表页若按后台语种显示，缺英文名这件事会被完全掩盖（而它恰好是最常见的缺失）。
 */
function titleOf(item: AdminProductSummary): string {
  return item.name[PUBLIC_DEFAULT_LOCALE] ?? Object.values(item.name)[0] ?? item.id
}

/** 缺哪些语种。以**全部受支持语种**为基准（不是以 `item.name` 的键为基准）。 */
function missingLocales(item: AdminProductSummary): string[] {
  return SUPPORTED_LOCALES.filter((locale) => !item.name[locale])
}

/** 已有哪些语种。同样以受支持语种为基准，顺序才稳定。 */
function presentLocales(item: AdminProductSummary): string[] {
  return SUPPORTED_LOCALES.filter((locale) => item.name[locale])
}

/*
 * 时间展示：接口给的是 ISO8601 UTC，直接 `replace('T',' ').slice(0,16)` 显示的是
 * **UTC 时间**，与运营者本地时钟有偏差。这里用 Intl 显式按运行时区格式化 ——
 * 存储仍是 UTC（硬约束 utc-storage），只有展示层转换。转换失败时回落原串，
 * 不让一个格式化异常把整张表打空。
 */
function formatTime(iso: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return iso
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed)
}

function messageFor(thrown: unknown): string {
  if (thrown instanceof ApiError) {
    if (thrown.code === 'FORBIDDEN') return '当前账号没有该操作的权限'
    if (thrown.code === 'NOT_FOUND') return '该产品已不存在，可能已被其他人删除'
    if (thrown.code === 'CONFLICT') return '存在引用关系，无法删除'
    if (thrown.code === 'BAD_REQUEST') return '提交的内容不合法，请打开产品检查必填项'
    return `操作失败（${thrown.code}）`
  }
  return '网络异常，请稍后重试'
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const result = await api.get<Page<AdminProductSummary>>(
      `/api/admin/products?page=${page.value}&pageSize=${PAGE_SIZE}`,
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
 * 请求放在 `onPositiveClick` 里并返回 Promise：对话框会一直保持 loading 到它落定，
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

/*
 * 设封面：沿用现有的媒体选择器（MediaPicker 的 props/events 契约不变）。
 *
 * ★ **必须整份提交产品**。更新接口是整份替换语义：只发一个 `{ coverMediaId }`
 * 会把 slug/name/description/specs/mediaIds/channels 全部清空，而且响应是 200，
 * 页面上不会有任何报错。所以这里先 `GET` 取完整 `Product`，
 * 经 `productToInput()` 转成写形状（这一步顺带把 `specs` 原样带上），再改一个字段。
 */
async function onCoverPicked(asset: MediaAsset | null): Promise<void> {
  const target = pickerTarget.value
  pickerTarget.value = null
  if (!target || !asset) return

  error.value = ''
  notice.value = ''
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

function onPageChange(next: number): void {
  page.value = next
  void load()
}

/*
 * 列定义。`title` 用字符串（不是 h()）——能写成字符串就别建 VNode，
 * 表格列会被反复创建，这一点在几十列的表上才有意义，但习惯一致比省一次 h() 重要。
 */
const columns: DataTableColumns<AdminProductSummary> = [
  {
    title: '名称',
    key: 'name',
    minWidth: 220,
    render: (item) =>
      h(RouterLink, { to: { name: 'product-edit', params: { id: item.id } } }, { default: () => titleOf(item) }),
  },
  {
    title: '状态',
    key: 'published',
    width: 100,
    render: (item) =>
      h(
        NTag,
        { type: item.published ? 'success' : 'error', size: 'small', bordered: false },
        { default: () => (item.published ? '已上架' : '未上架') },
      ),
  },
  {
    title: '已有语种',
    key: 'locales',
    width: 130,
    render: (item) => {
      const present = presentLocales(item)
      return present.length > 0 ? present.join(' / ') : '（无）'
    },
  },
  {
    /*
     * 缺语种**单独一列**并标红，而不是在"已有语种"里附一句 ——
     * "英文录了、中文忘了"是只看一种语言时最容易漏的事，
     * 它在列表里的表现是"有一行看起来完全正常"，所以必须有一个显眼的列专门回答它。
     */
    title: '缺失语种',
    key: 'missing',
    width: 140,
    render: (item) => {
      const missing = missingLocales(item)
      if (missing.length === 0) return h('span', { class: 'muted' }, '完整')
      return h(NTag, { type: 'warning', size: 'small', bordered: false }, { default: () => `缺 ${missing.join('/')}` })
    },
  },
  {
    title: '更新时间',
    key: 'updatedAt',
    width: 150,
    render: (item) => formatTime(item.updatedAt),
  },
  {
    title: '操作',
    key: 'actions',
    width: 260,
    render: (item) =>
      h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, [
        h(NButton, { size: 'small', quaternary: true, onClick: () => void togglePublished(item) }, {
          default: () => (item.published ? '下架' : '上架'),
        }),
        h(NButton, { size: 'small', quaternary: true, onClick: () => { pickerTarget.value = item } }, {
          default: () => (item.coverMediaId ? '换封面' : '设封面'),
        }),
        h(NButton, { size: 'small', quaternary: true, type: 'error', onClick: () => remove(item) }, {
          default: () => '删除',
        }),
      ]),
  },
]

/** 分页器配置。`page` 由 `onPageChange` 同步回 ref —— 受控组件不写回状态会"点不动"。 */
const pagination = computed(() => ({
  page: page.value,
  pageSize: PAGE_SIZE,
  itemCount: total.value,
  showSizePicker: false,
  prefix: () => `共 ${total.value} 个产品`,
}))

/*
 * 行 key 用 id。写成函数放这里而不是模板内联箭头函数：
 * 模板里的内联箭头函数拿不到 tsconfig 的类型上下文，`item` 会是隐式 any
 * （本仓库 base 配置开了 noImplicitAny）。放这里 `item` 有真类型。
 */
function rowKey(item: AdminProductSummary): string {
  return item.id
}

function goNew(): void {
  void router.push({ name: 'product-new' })
}

onMounted(load)
</script>

<template>
  <div class="page-head">
    <h1>产品</h1>
    <span class="spacer" />
    <n-button type="primary" @click="goNew">
      <template #icon>
        <n-icon :component="AddOutline" />
      </template>
      新建产品
    </n-button>
  </div>

  <n-alert v-if="error" type="error" style="margin-bottom: 14px" :show-icon="true">
    {{ error }}
  </n-alert>
  <n-alert v-else-if="notice" type="success" style="margin-bottom: 14px" :show-icon="true">
    {{ notice }}
  </n-alert>

  <div class="card">
    <!--
      loading 交给表格自己（它会遮住行区），不要在外面再盖一层"加载中…"——
      两层 loading 会在慢请求时同时出现，看起来像卡死了。

      空状态走表格自己的 `#empty` 插槽，而不是外面套一个 `v-if / v-else`：
      后者会让"加载中"和"没有数据"变成两棵不同的组件树，慢请求时先渲染一张空表、
      数据回来再整体替换成空状态，视觉上会闪一下。插槽方式则只有一棵树。
    -->
    <n-data-table
      remote
      :columns="columns"
      :data="list"
      :loading="loading"
      :pagination="pagination"
      :row-key="rowKey"
      :bordered="false"
      @update:page="onPageChange"
    >
      <!--
        空状态保留原提示的**业务含义**：未上架的产品不会出现在前台站点。
        这是只看后台列表时最容易忘的一条 —— 台账里明明有 200 条，
        前台却可能是空的，而原因就在"上架"这一列。
      -->
      <template #empty>
        <n-empty description="还没有产品">
          <template #extra>
            <div style="max-width: 520px; text-align: left">
              <p class="muted" style="margin-top: 0">点右上角「新建产品」开始录入。</p>
              <p class="muted" style="margin-bottom: 0">
                <strong>未上架的产品不会出现在前台站点</strong> ——
                产品建好后必须再点一次「上架」，否则前台看不到它（这不会报错，只是不显示）。
              </p>
            </div>
          </template>
        </n-empty>
      </template>
    </n-data-table>
  </div>

  <!--
    媒体选择器：`multiple=false` 时点一下图片就通过 `picked` 事件回来。
    用 v-if 而不是 v-show 控制：不打开时不该有 DOM，更不该触发它的列表请求。
  -->
  <MediaPicker
    v-if="pickerTarget"
    :multiple="false"
    @picked="onCoverPicked"
    @close="pickerTarget = null"
  />
</template>

<style scoped>
.page-head {
  display: flex;
  align-items: center;
  margin-bottom: 16px;
}
.page-head h1 { margin: 0; }
.spacer { flex: 1; }
</style>
