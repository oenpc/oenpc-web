import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/*
 * ★ `base: '/admin/'` **必须与 nginx 的 location 一致**。
 *
 * 若用默认的 `'/'`，产物里的资源引用会是 `/assets/index-xxx.js`，
 * 而 nginx 会把这个请求交给**前台站点**去处理 —— 前台没有这个文件，
 * 于是返回前台的 404 页面，浏览器报"Unexpected token '<'"（把 HTML 当 JS 解析）。
 * 这个症状很容易被误判成"构建坏了"，实际是 base 与部署路径不匹配。
 *
 * 开发时 `vite dev` 通过 proxy 把 /api 与 /media 转到后端，避免跨域。
 */
export default defineConfig({
  base: '/admin/',
  plugins: [vue()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:3900', changeOrigin: true },
      '/media': { target: 'http://127.0.0.1:3900', changeOrigin: true },
    },
  },
})
