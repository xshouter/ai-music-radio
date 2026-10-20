#!/usr/bin/env node
// 把内置的网易云兼容服务（NeteaseCloudMusicApi，连同依赖约 27MB）拉到 vendor/netease/。
// 不进 git —— 这是第三方代码，不是我们的源码。
//
// 为什么不写进 dependencies：它不是被 import 的库，而是**要被 spawn 的独立进程**。
// 放 dependencies 会把它那一大串传递依赖混进根 node_modules，打包时反而要逐个点名。
// 按目录装、按目录拷，边界最清楚（和 vendor/piper 同一个套路）。
//
//   node tools/fetch-netease.mjs           # 缺才装
//   node tools/fetch-netease.mjs --force   # 重装
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// 钉死版本：上游接口一改，我们的响应映射就可能要跟着动，浮动版本会把「哪天坏的」变成不可知。
const PINNED = 'NeteaseCloudMusicApi@4.32.0';
const VERSION = PINNED.slice(PINNED.indexOf('@') + 1);
const root = join(process.cwd(), 'vendor', 'netease');
const manifest = join(root, 'node_modules', 'NeteaseCloudMusicApi', 'package.json');

const have = () => {
  if (!existsSync(manifest)) return false;
  try {
    return JSON.parse(readFileSync(manifest, 'utf8')).version === VERSION;
  } catch {
    return false;
  }
};

if (have() && !process.argv.includes('--force')) {
  console.log('  vendor/netease 已就绪（' + VERSION + '）');
} else {
  mkdirSync(root, { recursive: true });
  console.log('  安装 ' + PINNED + ' → vendor/netease/');
  execFileSync('npm', ['install', '--prefix', root, '--no-audit', '--no-fund', '--loglevel=error', PINNED], {
    stdio: 'inherit',
    // Windows 上 npm 是 npm.cmd，而 Node 20 起 execFile 不许直接跑 .cmd（CVE-2024-27980），必须过 shell。
    shell: process.platform === 'win32',
  });
  if (!have()) {
    console.error('  装完了但版本对不上：' + manifest);
    process.exit(1);
  }
}