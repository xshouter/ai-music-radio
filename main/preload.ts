// 渲染进程与主进程之间唯一的桥。只递一个东西：一次性令牌。
// 令牌走 additionalArguments 进来（webPreferences），这里只做搬运 —— 不暴露 ipcRenderer、不暴露 node。
import { contextBridge } from 'electron';

const PREFIX = '--radio-token=';
const arg = process.argv.find((value) => value.startsWith(PREFIX));

contextBridge.exposeInMainWorld('__RADIO__', {
  token: arg === undefined ? '' : arg.slice(PREFIX.length),
});