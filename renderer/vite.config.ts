import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// mock 的地址。要用别的端口，改这一行（mock 用 PORT=9000 起时）。
// 为什么走 dev proxy 而不是让浏览器直接打 127.0.0.1:8765：mock 不发 CORS 头，
// 跨源会被浏览器挡掉；而真后端由我们写，所以这不是契约问题，是开发期的事。
const MOCK = 'http://127.0.0.1:8765';
const proxy = { target: MOCK, changeOrigin: true, ws: true };

export default defineConfig({
  plugins: [react()],
  // 阶段 5 由 Electron 用 file:// 加载 dist，绝对路径会 404，所以必须是相对路径。
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { '/api': proxy, '/tts': proxy, '/stream': proxy },
  },
});