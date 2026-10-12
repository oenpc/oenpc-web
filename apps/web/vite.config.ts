import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/*
 * 客户端与 SSR 用**同一份配置**，靠 CLI 的 `--ssr` 与 `--outDir` 区分：
 *   vite build --outDir dist/client --emptyOutDir
 *   vite build --ssr src/entry-server.ts --outDir dist/server
 *
 * 两个产物目录必须分开，且 SSR 那次**不能** emptyOutDir ——
 * 否则会把刚构建好的客户端产物删掉（这个症状很像"构建顺序错了"，
 * 但其实是第二次构建清空了第一次的结果）。
 */
export default defineConfig({
  plugins: [vue()],
  build: {
    /* 产物里不留 sourcemap：静态站点直接托管，不需要，且会拖大发布包 */
    sourcemap: false,
  },
})
