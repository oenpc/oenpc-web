/*
 * 让 tsc 能解析 `import App from './App.vue'`。
 *
 * 只是**模块形状声明** —— 真正的 SFC 类型检查要靠 `vue-tsc`（P1 引入）。
 * 没有这个文件，`tsc --noEmit` 会在每个 .vue 导入上报 TS2307。
 */
declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}
