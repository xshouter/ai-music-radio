#!/usr/bin/env node
// 铁律 5 的机械检查：渲染进程永远不碰数据库 / 存储 / node 内建。
// 规则来源：docs/abstraction-layer.md 第 2 节的依赖表。
// 用法：node tools/check-boundaries.mjs  （CI 与本地同一份脚本，零依赖）
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extname, join, relative } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'build', 'release', 'cache', 'data']);

// 每层允许 / 禁止什么。禁止项分三种写法：裸模块名、路径前缀、源码特征串。
const LAYERS = {
  'renderer': {
    desc: '渲染进程只能依赖 shared/ 的类型',
    modules: ['better-sqlite3', 'sqlite3', 'electron', 'fs', 'node:fs', 'path', 'node:path', 'child_process', 'node:child_process', 'net', 'node:net'],
    prefixes: ['core/', 'main/'],
    patterns: [
      [/\bbetter-sqlite3\b/i, '出现 better-sqlite3'],
      [/\bSELECT\b[\s\S]{0,200}?\bFROM\b/i, '出现 SQL SELECT'],
      [/\bINSERT\s+INTO\b/i, '出现 SQL INSERT'],
      [/\.sqlite\b/i, '出现数据库文件'],
      [/\bMUSIC_U\b/, '出现网易云凭据 MUSIC_U'],
      [/\bopenai[_-]?api[_-]?key\b/i, '出现 API key 明文读写'],
    ],
  },
  'core': {
    desc: '后端内核不许碰 Electron 与渲染进程',
    modules: ['electron'],
    prefixes: ['renderer/'],
    patterns: [],
  },
  'main': {
    // 组装点与外壳：可以 import core/ 与 electron；不许 import renderer/ 的**源码**
    // （它只认 renderer 的构建产物，而且只是把一个目录路径交给内核去发）。
    desc: '外壳只认 core/ 与构建产物，不认 renderer 源码',
    modules: [],
    prefixes: ['renderer/'],
    patterns: [],
  },
  'shared': {
    desc: 'shared/ 只有类型，零运行时依赖',
    modules: null,      // null = 禁止一切非 type-only import
    prefixes: null,
    patterns: [],
  },
};

const SPECIFIER_RE = new RegExp(
  String.raw`\b(?:import|export)\b([^;]*?)\bfrom\s*(['"])([^'"]+)\2` +
  String.raw`|\bimport\s*(['"])([^'"]+)\4` +
  String.raw`|\brequire\s*\(\s*(['"])([^'"]+)\6\s*\)`,
  'g',
);

function sourceFiles(dir, found = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found; // 目录还不存在，跳过
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) sourceFiles(join(dir, entry.name), found);
    } else if (EXTENSIONS.has(extname(entry.name))) {
      found.push(join(dir, entry.name));
    }
  }
  return found;
}

function importsOf(source) {
  const found = [];
  for (const match of source.matchAll(SPECIFIER_RE)) {
    found.push({
      spec: match[3] ?? match[5] ?? match[7],
      typeOnly: /\btype\b/.test(match[1] ?? ''),
    });
  }
  return found;
}

// ../../core/x 与 core/x 视为同一件事
const normalize = (spec) => spec.replace(/^(?:\.{1,2}\/)+/, '');

const violations = [];
const scanned = [];

for (const [layer, rule] of Object.entries(LAYERS)) {
  const layerDir = join(ROOT, layer);
  const files = sourceFiles(layerDir);
  scanned.push(`${layer}/ ${files.length} 个文件`);

  for (const file of files) {
    const rel = relative(ROOT, file);
    const source = readFileSync(file, 'utf8');

    for (const { spec, typeOnly } of importsOf(source)) {
      const where = `${rel}: import '${spec}'`;
      if (rule.modules === null) {
        if (!typeOnly) violations.push(`${where} → ${layer}/ 只能有 type-only import`);
        continue;
      }
      const bare = normalize(spec);
      if (rule.modules.includes(bare)) violations.push(`${where} → 禁止依赖 ${bare}`);
      else if (rule.prefixes.some((p) => bare.startsWith(p))) violations.push(`${where} → 禁止依赖 ${bare.split('/')[0]}/ 层`);
    }

    for (const [pattern, message] of rule.patterns ?? []) {
      if (pattern.test(source)) violations.push(`${rel} → ${message}`);
    }
  }
}

console.log(`扫描：${scanned.join('、')}`);

if (violations.length > 0) {
  console.error(`\n✗ 依赖边界检查失败：${violations.length} 处违规\n`);
  for (const violation of violations) console.error(`  ${violation}`);
  console.error('\n规则见 docs/abstraction-layer.md 第 2 节 与 docs/engineering-rules.md 铁律 5。');
  process.exit(1);
}

console.log('✓ 依赖边界检查通过');