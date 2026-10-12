/*
 * 让 tsc 能解析 `import X from './X.vue'`。
 * 与 apps/web/src/env.d.ts 同理：这里只是**模块形状声明**，
 * 真正的 SFC 类型检查要靠 vue-tsc。
 */
declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}
