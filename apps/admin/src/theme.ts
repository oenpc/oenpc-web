/*
 * 亮/暗主题的作用域状态。
 *
 * ## 为什么用 provide/inject 而不是模块级变量
 *
 * 主题是**一次运行实例**的状态，不是**进程**的状态。写成模块级 `let isDark = ref(...)`
 * 看着更短，但那份状态会活过组件树：本仓库已记录过这个陷阱 ——
 * 模块级可变状态在 SSR / 多实例下会跨页面泄漏（一次渲染改了它，下一次渲染接着用）。
 * `provide` 放的是**这次实例**的值；App.vue 每次挂载都会新建一个 ref。
 *
 * ## 为什么状态在 App.vue 而不是这里
 *
 * `n-config-provider` 的 `theme` 是 App.vue 的 prop，而 provider 又在 AppRoot 的**上游** ——
 * AppRoot 没法把值"传上去"。所以状态必须由 App.vue 持有，再 provide 给下游的 AppRoot 消费。
 * `let injection = null` 是**单次 setup 的局部变量**（不是模块状态），只用来承载 inject 的结果。
 */

import { inject, provide, ref, type InjectionKey, type Ref } from 'vue'
import { darkTheme, type GlobalTheme } from 'naive-ui'
import { getThemeMode, setThemeMode, type ThemeMode } from './admin-preferences'

export interface AdminTheme {
  mode: Ref<ThemeMode>
  /** 直接交给 `n-config-provider` 的 `theme`。 */
  naiveTheme: Ref<GlobalTheme | null>
  toggleTheme: () => void
}

const THEME_KEY: InjectionKey<AdminTheme> = Symbol('admin-theme')

/**
 * 把当前主题同步到 `document.body` 的 class。
 *
 * Naive UI 的 `darkTheme` 只管它自己的组件，而本后台还有一批**手写** CSS
 * （styles.css 里的 `.card` / `.overlay` / `input` 等）走的是 `--bg` / `--surface` 这类
 * CSS 变量。不挂这个 class，切到暗色后那些区域仍是白的 —— 半明半暗比全亮更难看清。
 */
function applyToDocument(mode: ThemeMode): void {
  document.body.classList.toggle('dark', mode === 'dark')
}

/** 在 App.vue 里调用一次：读 localStorage → 建状态 → provide。 */
export function provideAdminTheme(): AdminTheme {
  const mode = ref<ThemeMode>(getThemeMode())
  applyToDocument(mode.value)

  const naiveTheme = ref<GlobalTheme | null>(mode.value === 'dark' ? darkTheme : null)

  const toggleTheme = (): void => {
    const next: ThemeMode = mode.value === 'dark' ? 'light' : 'dark'
    mode.value = next
    naiveTheme.value = next === 'dark' ? darkTheme : null
    applyToDocument(next)
    /* 持久化放在最后：即使写 localStorage 失败，界面也已经切过去了 */
    setThemeMode(next)
  }

  const state: AdminTheme = { mode, naiveTheme, toggleTheme }
  provide(THEME_KEY, state)
  return state
}

/** 在 AppRoot.vue 里调用：拿上层 provide 的主题状态（拿不到就抛，而不是静默退回亮色）。 */
export function useAdminTheme(): AdminTheme {
  const injection = inject(THEME_KEY, null)
  if (injection === null) {
    throw new Error('useAdminTheme() 必须在 provideAdminTheme() 的子树内调用（见 App.vue）')
  }
  return injection
}
