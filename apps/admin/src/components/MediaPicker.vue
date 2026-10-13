<script setup lang="ts">
/*
 * 媒体选择器 —— 上传 + 从已有媒体里挑。
 *
 * 单选用 `picked`（点一下就确定），多选用 `confirmed`（勾选后点确定）。
 * 两种模式共用一个组件而不是两个：上传、列表、删除这三块逻辑完全相同，
 * 分成两个组件会让"删除了仍被引用的图片"这类策略在两处各写一遍。
 */
import { onMounted, ref } from 'vue'
import { useDialog } from 'naive-ui'
import type { MediaAsset, Page } from '@oenpc-web/shared'
import { ApiError, api } from '../api'

/* 本组件挂在路由页面之下，同样在 App.vue 的 provider 子树里 */
const dialog = useDialog()

const props = defineProps<{ multiple?: boolean }>()
const emit = defineEmits<{
  (event: 'picked', asset: MediaAsset): void
  (event: 'confirmed', assets: MediaAsset[]): void
  (event: 'close'): void
}>()

const items = ref<MediaAsset[]>([])
const selected = ref<string[]>([])
const loading = ref(true)
const uploading = ref(false)
const error = ref('')
const notice = ref('')

function messageFor(thrown: unknown): string {
  if (thrown instanceof ApiError) {
    if (thrown.code === 'UNSUPPORTED_MEDIA_TYPE') {
      return '只支持 JPEG / PNG / WebP / GIF —— SVG 被排除是有意的（它可以内嵌脚本）'
    }
    if (thrown.code === 'PAYLOAD_TOO_LARGE') {
      const max = thrown.meta?.maxBytes
      return typeof max === 'number' ? `文件太大，上限 ${Math.round(max / 1024 / 1024)} MB` : '文件太大'
    }
    if (thrown.code === 'CONFLICT') {
      const refs = thrown.meta?.references
      return `有 ${refs ?? '若干'} 个产品还在引用这张图片，先在那些产品里移除它`
    }
    return `操作失败（${thrown.code}）`
  }
  return '网络异常，请稍后重试'
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const result = await api.get<Page<MediaAsset>>('/api/admin/media?page=1&pageSize=60')
    items.value = result.items
  } catch (thrown) {
    error.value = messageFor(thrown)
  } finally {
    loading.value = false
  }
}

async function onFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  /* 立刻清空 input，否则连续上传同一个文件不会触发 change */
  input.value = ''
  if (!file) return

  uploading.value = true
  error.value = ''
  notice.value = ''
  try {
    const asset = await api.upload<MediaAsset>('/api/admin/media', file)
    notice.value = `已上传：${asset.filename}`
    await load()
    /* 单选模式下上传完直接选中，省掉一次点击 */
    if (!props.multiple) emit('picked', asset)
  } catch (thrown) {
    error.value = messageFor(thrown)
  } finally {
    uploading.value = false
  }
}

function choose(asset: MediaAsset): void {
  if (props.multiple) {
    selected.value = selected.value.includes(asset.id)
      ? selected.value.filter((id) => id !== asset.id)
      : [...selected.value, asset.id]
    return
  }
  emit('picked', asset)
}

/*
 * 二次确认走 useDialog（原生弹窗会阻塞主线程、测试驱动不了、样式与主题不一致）。
 * 标签里的删除按钮带 @click.stop，否则点它会顺带触发外层缩略图的"选中这张图"。
 */
function remove(asset: MediaAsset): void {
  dialog.warning({
    title: '删除媒体',
    content: `删除「${asset.filename}」？若仍有产品引用它，删除会被拒绝。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: () => performRemove(asset),
  })
}

async function performRemove(asset: MediaAsset): Promise<void> {
  error.value = ''
  notice.value = ''
  try {
    await api.del(`/api/admin/media/${asset.id}`)
    notice.value = '已删除'
    await load()
  } catch (thrown) {
    error.value = messageFor(thrown)
  }
}

function confirm(): void {
  emit(
    'confirmed',
    items.value.filter((asset) => selected.value.includes(asset.id)),
  )
}

onMounted(load)
</script>

<template>
  <div class="overlay">
    <div class="modal card">
      <div style="display: flex; align-items: center; margin-bottom: 12px">
        <h2 style="margin: 0">{{ props.multiple ? '选择图片（可多选）' : '选择封面图' }}</h2>
        <span style="flex: 1" />
        <label class="btn btn-ghost btn-small" style="cursor: pointer">
          {{ uploading ? '上传中…' : '上传图片' }}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            style="display: none"
            :disabled="uploading"
            @change="onFileChange"
          />
        </label>
      </div>

      <p class="muted" style="margin-top: 0">
        支持 JPEG / PNG / WebP / GIF，单文件上限 10 MB。<strong>不支持 SVG</strong>（可内嵌脚本）。
      </p>

      <p v-if="error" class="alert alert-error">{{ error }}</p>
      <p v-else-if="notice" class="alert alert-ok">{{ notice }}</p>

      <p v-if="loading" class="muted">加载中…</p>
      <p v-else-if="items.length === 0" class="alert alert-warn">媒体库还是空的，先上传一张。</p>

      <div v-else class="media-grid">
        <div
          v-for="asset in items"
          :key="asset.id"
          class="media-item"
          :class="{ selected: selected.includes(asset.id) }"
          style="cursor: pointer"
          @click="choose(asset)"
        >
          <img :src="asset.url" :alt="asset.filename" loading="lazy" />
          <div class="media-name">{{ asset.filename }}</div>
          <div style="padding: 0 6px 6px">
            <button
              class="btn btn-danger btn-small"
              type="button"
              style="width: 100%"
              @click.stop="remove(asset)"
            >
              删除
            </button>
          </div>
        </div>
      </div>

      <div style="display: flex; gap: 8px; margin-top: 16px">
        <span style="flex: 1" />
        <button class="btn btn-ghost" type="button" @click="emit('close')">取消</button>
        <button v-if="props.multiple" class="btn" type="button" @click="confirm">
          确定（已选 {{ selected.length }}）
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 40px 16px;
  overflow: auto;
  z-index: 50;
}
.modal {
  width: 100%;
  max-width: 760px;
  margin: 0;
}
</style>
