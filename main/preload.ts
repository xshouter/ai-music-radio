// 渲染进程与主进程之间唯一的桥。只递两个东西：一次性令牌、关窗。
// 令牌走 additionalArguments 进来（webPreferences）。ipcRenderer 本体不外露，只包成一个具名动作。
import { contextBridge, ipcRenderer } from 'electron';

const PREFIX = '--radio-token=';
const arg = process.argv.find((value) => value.startsWith(PREFIX));

contextBridge.exposeInMainWorld('__RADIO__', {
  token: arg === undefined ? '' : arg.slice(PREFIX.length),
  // 无边框窗口没有系统关闭键，渲染层需要一条明确的关窗通道。
  close: () => ipcRenderer.send('radio:close'),
});