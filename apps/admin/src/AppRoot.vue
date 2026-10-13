<script setup lang="ts">
/*
 * 应用根内层 —— provider 的**下游**，所以这里的子树可以用 useMessage/useDialog/useThemeVars。
 *
 * 它承担两件事：
 *   ① 未登录时只渲染登录页；
 *   ② 已登录时渲染后台外壳（侧边栏菜单 + 顶部栏 + 内容区）。
 *
 * ## 为什么"是否登录"是 computed 读 `route.fullPath`
 *
 * `session.ts` 是纯读写 localStorage 的函数，令牌本身不可响应。
 * 三条改变登录态的路径（登录成功、主动退出、401 清理）**都伴随着一次路由跳转**，
 * 所以把路由读一次当依赖即可重新求值 —— 不值得为此引入一个可能与 localStorage
 * 不一致的可写 store。
 */
import { computed, h, ref } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { NIcon, type MenuOption } from 'naive-ui'
import {
  CubeOutline,
  ImagesOutline,
  LogOutOutline,
  MenuOutline,
  MoonOutline,
  SunnyOutline,
} from '@vicons/ionicons5'
import { api } from './api'
import { getToken, setToken } from './session'
import { getAdminIdentity, setAdminIdentity } from './admin-preferences'
import { useAdminTheme } from './theme'
import LoginView from './views/LoginView.vue'

const route = useRoute()
const router = useRouter()
const { mode, toggleTheme } = useAdminTheme()

const showLogin = computed(() => {
  void route.fullPath
  return getToken() === null || route.meta.public === true
})

/*
 * 展示"当前登录的是谁"。
 *
 * 取值来自登录时记下的展示名（见 admin-preferences.ts），**不额外请求 `/me`**：
 * 只为一行动态文字多一次网络往返、多一个失败态不划算。
 * 代价说清楚：`getAdminIdentity()` 读的是 localStorage，**不可响应** ——
 * 它只在 AppRoot 重新求值时才更新，所以"不退出就换账号"这条路径上，
 * 顶部栏仍会显示上一次登录的名字（退出登录会清掉它，因此不会跨会话残留）。
 */
const who = computed(() => getAdminIdentity() ?? '未记录用户')

/*
 * 菜单项。`key` 直接取**路由 name**，于是"高亮哪个"与"点了跳哪里"共用同一个值 ——
 * 两套映射（一套 key→路由、一套路由→key）是这类菜单最典型的不一致来源。
 */
const menuOptions: MenuOption[] = [
  {
    label: '产品管理',
    key: 'products',
    icon: () => h(NIcon, null, { default: () => h(CubeOutline) }),
  },
  {
    label: '媒体库',
    key: 'media',
    icon: () => h(NIcon, null, { default: () => h(ImagesOutline) }),
  },
]

/*
 * 高亮项偏向父级：产品编辑页（product-new / product-edit）也属于产品管理，
 * 若严格照 route.name 高亮，进编辑页后侧边栏会**什么都不高亮** —— 看起来像导航坏了。
 * 这是有意偏离"严格等于 route.name"的唯一一处。
 */
const activeKey = computed(() => {
  const name = String(route.name ?? '')
  if (name.startsWith('product')) return 'products'
  return name === 'media' ? 'media' : ''
})

/*
 * 侧边栏折叠：默认由**路由**推导 —— 进产品编辑页时收起，
 * 因为编辑页是宽表单，200px 侧边栏会明显挤压输入区，而编辑时几乎不需要切页面。
 *
 * 手动点过折叠按钮后以手动值为准（`manualCollapsed`），否则路由一变就会被弹回去：
 * 用户刚点开又被自动收起，会以为按钮失灵。
 */
const manualCollapsed = ref<boolean | null>(null)
const siderCollapsed = computed(() => {
  if (manualCollapsed.value !== null) return manualCollapsed.value
  return route.name === 'product-edit' || route.name === 'product-new'
})
const onCollapseChange = (value: boolean): void => {
  manualCollapsed.value = value
}

/*
 * 菜单跳转按 `key` 当路由 name 用 —— 名字对不上时 router.push 会抛，
 * 而不是静默跳到某个错误页面，这正是我们想要的失败方式。
 */
function onMenuSelect(key: string): void {
  void router.push({ name: key })
}

async function logout(): Promise<void> {
  try {
    await api.post('/api/auth/logout', {})
  } catch {
    /* 服务端可能已经没这个会话了（过期/重启）—— 本地清掉就是"登出成功" */
  }
  setToken(null)
  /* 连展示名一起清：否则换账号登录前，顶部栏会显示上一个账号的名字 */
  setAdminIdentity(null)
  await router.push({ name: 'login' })
}
</script>

<template>
  <!-- 未登录只渲染登录页：此时还没有会话，任何导航都会让人误以为已经登录了 -->
  <LoginView v-if="showLogin" />

  <!--
    外壳用 n-layout：它自带"内容区滚动靠内层"的正确滚动条位置。
    自己用 flex + overflow 搭同样能跑，但滚动条会出现在整页上，
    固定顶部栏就得再写一套 position: sticky 与 z-index —— 那是组件库已经解掉的问题。
  -->
  <n-layout v-else class="shell" has-sider position="absolute">
    <n-layout-sider
      bordered
      collapse-mode="width"
      :width="200"
      :collapsed-width="64"
      :collapsed="siderCollapsed"
      show-trigger
      @update:collapsed="onCollapseChange"
    >
      <div class="sider-brand">
        <n-icon :component="MenuOutline" :size="18" />
        <span v-if="!siderCollapsed" class="sider-brand-text">OENPC-WEB</span>
      </div>
      <n-menu
        :value="activeKey"
        :collapsed="siderCollapsed"
        :collapsed-width="64"
        :collapsed-icon-size="20"
        :options="menuOptions"
        @update:value="onMenuSelect"
      />
    </n-layout-sider>

    <n-layout>
      <n-layout-header bordered class="topbar">
        <span class="brand">后台管理</span>
        <span class="spacer" />

        <!--
          主题按钮显示的是"点了会变成什么"（暗色模式下显示"亮色"），
          而不是当前状态 —— 按钮上的字描述动作，用户不必先反推当前处于哪个模式。
        -->
        <n-button
          quaternary
          size="small"
          :title="mode === 'dark' ? '切换到亮色主题' : '切换到暗色主题'"
          @click="toggleTheme"
        >
          <template #icon>
            <n-icon :component="mode === 'dark' ? SunnyOutline : MoonOutline" />
          </template>
          {{ mode === 'dark' ? '亮色' : '暗色' }}
        </n-button>

        <span class="who">当前登录：{{ who }}</span>

        <n-button quaternary size="small" @click="logout">
          <template #icon>
            <n-icon :component="LogOutOutline" />
          </template>
          退出登录
        </n-button>
      </n-layout-header>

      <n-layout-content class="content" :native-scrollbar="false">
        <RouterView />
      </n-layout-content>
    </n-layout>
  </n-layout>
</template>
