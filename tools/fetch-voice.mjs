#!/usr/bin/env node
// 把离线嗓子（piper 运行时 + 语音模型，约 140MB）拉到 vendor/piper/。不进 git —— 它是二进制资产。
//
// 为什么要绕路：GitHub Release 的资产走 objects.githubusercontent.com，huggingface.co 也一样，
// 在这台机器上都被 hosts 劫持到 127.0.0.1，直连会**挂死**（不是失败，是永远不返回）。
// 所以走两个公共镜像。镜像是可替换的实现细节，不是架构决定。
//
//   node tools/fetch-voice.mjs                 # 缺什么拉什么
//   node tools/fetch-voice.mjs --force         # 全量重拉
//   node tools/fetch-voice.mjs --voice=en_US-ryan-high
import { execFileSync } from 'node:child_process';
import { createWriteStream, cpSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync } from 'node:fs';
import { request } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PIPER_ZIP = 'https://gh-proxy.com/https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip';
// 镜像按序试；第一个是从国内可达的那个。换成别的镜像是改这一行，不是改逻辑。
const VOICE_MIRRORS = ['https://hf-mirror.com', 'https://huggingface.co'];
const VOICE_REPO = '/rhasspy/piper-voices/resolve/main';

const arg = (name, fallback) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith('--' + name + '='));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};
const force = process.argv.includes('--force');
const voice = arg('voice', 'en_US-ryan-high');
const root = join(process.cwd(), 'vendor', 'piper');

const get = (url, out) =>
  new Promise((resolve, reject) => {
    request(url, { timeout: 600000, headers: { 'user-agent': 'node', accept: '*/*' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        get(new URL(res.headers.location, url).href, out).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error('HTTP ' + res.statusCode + ' <- ' + url));
        return;
      }
      const size = Number(res.headers['content-length'] || 0);
      const part = out + '.part';
      const file = createWriteStream(part);
      res.pipe(file);
      file.on('finish', () => {
        renameSync(part, out); // 半截文件绝不留成「已完成」——否则下次会被 have() 当成有货
        console.log('  ' + out.slice(out.lastIndexOf('\\') + 1) + '  ' + (size / 1048576).toFixed(1) + 'MB');
        resolve();
      });
      file.on('error', reject);
    })
      .on('error', reject)
      .on('timeout', function () {
        this.destroy();
        reject(new Error('timeout <- ' + url));
      })
      .end();
  });

const have = (path) => !force && existsSync(path) && statSync(path).size > 0;

mkdirSync(root, { recursive: true });

// 1) piper 运行时（exe + dll + espeak-ng-data）
if (have(join(root, 'piper.exe'))) {
  console.log('- piper 运行时已在，跳过');
} else {
  console.log('> piper 运行时');
  const zip = join(root, '.piper.zip');
  await get(PIPER_ZIP, zip);
  const staging = mkdtempSync(join(tmpdir(), 'edgerunner-piper-'));
  execFileSync('tar', ['-xf', zip, '-C', staging]);
  cpSync(join(staging, 'piper'), root, { recursive: true });
  rmSync(staging, { recursive: true, force: true });
  rmSync(zip, { force: true });
}

// 2) 语音模型。文件名约定：<locale>-<name>-<quality>，仓库里的路径是 <lang>/<locale>/<name>/<quality>/<file>。
const [locale, name, quality] = voice.split('-');
const file = voice + '.onnx';
const repo = [locale.slice(0, 2), locale, name, quality, file].join('/');
// 上一轮如果被镜像超时打断，清掉半截文件（have() 只看「存在且非空」，半截会被误判成有货）。
for (const leftover of [join(root, file + '.part'), join(root, file + '.json.part')]) rmSync(leftover, { force: true });
for (const suffix of ['', '.json']) {
  const target = join(root, file + suffix);
  if (have(target)) {
    console.log('- ' + file + suffix + ' 已在，跳过');
    continue;
  }
  console.log('> ' + file + suffix);
  let failure = null;
  for (const mirror of VOICE_MIRRORS) {
    try {
      await get(mirror + VOICE_REPO + '/' + repo + suffix, target);
      failure = null;
      break;
    } catch (error) {
      failure = error;
      console.log('  ' + mirror + ' 没成：' + error.message);
    }
  }
  if (failure !== null) throw failure;
}

console.log('✓ vendor/piper 就绪：' + root);