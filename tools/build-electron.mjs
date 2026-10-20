#!/usr/bin/env node
// 把 main/ + core/ 打成一个 CJS 文件（electron/main.cjs）。
//
// 为什么打包而不是让 Electron 直接跑 .ts：内核用的是 `import './x.ts'` 这种带后缀的相对导入
// （tsconfig 开了 allowImportingTsExtensions），Node 与 Electron 都不认。esbuild 认 —— 它按字面路径解析。
// electron 保持 external：运行时的 electron 由外壳提供，不打包进来。
import { build } from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  logLevel: 'warning',
  legalComments: 'none',
};

const targets = [
  { entryPoints: ['main/main.ts'], outfile: 'electron/main.cjs' },
  { entryPoints: ['main/preload.ts'], outfile: 'electron/preload.cjs' },
];

for (const target of targets) {
  const result = await build({ ...common, ...target, metafile: true });
  const bytes = Object.values(result.metafile.outputs)[0].bytes;
  console.log('  ' + target.outfile + '  ' + (bytes / 1024).toFixed(1) + ' kB');
}