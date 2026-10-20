// 打包后，一次性令牌由 Electron 的 preload 注入到 window.__RADIO__（main/preload.ts）。
// 开发期它不存在 —— 那时靠 VITE_RADIO_TOKEN（vite dev proxy，见 client.ts）。
interface Window {
  readonly __RADIO__?: { readonly token?: string; readonly close?: () => void };
}