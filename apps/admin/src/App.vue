<script setup lang="ts">
/*
 * 应用根 —— **只装配 provider，不消费它们**。
 *
 * ★ 为什么要拆出 AppRoot.vue
 *
 * Naive UI 的 useMessage / useDialog / useNotification / useLoadingBar 都是
 * provide/inject：向上找**最近的** provider。而 provide 只对子树可见 ——
 * 一个组件里既 provide 又 inject，拿到的是 undefined（不是报错，也不是回落到默认实现），
 * 真正抛错要等到调用时（"No outer <n-message-provider /> founded"）。
 * 所以"提供者"与"使用者"必须分属两个组件：本文件提供，AppRoot.vue 及路由页面使用。
 * 这也正是 `useDialog` 能在 LoginView / ProductListView / MediaPicker 里直接用到的原因。
 *
 * locale 挂 `zhCN` + `dateZhCN`：后台是内部单语工具（见索引 apps/admin/ 条目的文案策略），
 * 但组件**内置**文案（分页器、日期面板、确认框按钮）不跟着走就会中英混排 ——
 * 这一层不是"要不要国际化"的问题，而是"同一屏里不要出现两种语言"。
 *
 * ★ 主题状态为什么落在本文件：`theme` 是 `n-config-provider` 的 prop，而 provider 在
 * AppRoot 的**上游** —— AppRoot 自己没法把值传上来。所以由这里持有状态并 provide，
 * AppRoot（下游）用 `useAdminTheme()` 消费。见 theme.ts 里关于"不用模块级可变变量"的说明。
 *
 * 不引 vfonts：字体由 styles.css 的 font-family 统一指定，多一份字体包只是白增体积。
 */
import { zhCN, dateZhCN } from 'naive-ui'
import AppRoot from './AppRoot.vue'
import { provideAdminTheme } from './theme'

const { naiveTheme } = provideAdminTheme()
</script>

<template>
  <n-config-provider :locale="zhCN" :date-locale="dateZhCN" :theme="naiveTheme">
    <n-loading-bar-provider>
      <n-dialog-provider>
        <n-message-provider>
          <n-notification-provider>
            <AppRoot />
          </n-notification-provider>
        </n-message-provider>
      </n-dialog-provider>
    </n-loading-bar-provider>
  </n-config-provider>
</template>
