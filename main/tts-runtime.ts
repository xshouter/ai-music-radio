// piper.exe 的路径约束只有这里有资格知道 —— 它是因为 Windows 上 espeak-ng 的 fopen 才存在的。
// 这里**故意不 import electron**：落点是调用方给的，函数本身是纯的，冒烟脚本也能用同一套规则。
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const isAscii = (path: string): boolean => /^[\x00-\x7f]*$/.test(path);

/**
 * piper.exe 用 fopen 读自己的 espeak-ng-data：路径含非 ASCII 时 espeak 报
 * `Illegal byte sequence` 并**产出 0 字节音频**（中文路径下实测）。
 * 而打包后 resourcesPath 落在 %TEMP% 下、开发时落在仓库目录下 —— 两者都可能带中文
 * （这个仓库自己就在 `D:\...\ai音乐电台`）。
 *
 * 所以：**源目录本身就是 ASCII 就直接用**（绝大多数人不用付这份拷贝）；不是就把整份运行时
 * 拷到第一个 ASCII 的落点（userData → ProgramData）下一次，之后都跑拷贝副本。
 */
export function resolveTtsDir(source: string, primary: string, secondary: string): string {
  if (isAscii(source)) return source;
  // shortcut: 两个落点都非 ASCII（系统盘或用户名是中文、且 ProgramData 被改过）时只能退到 primary，
  // 那种机器上 piper 仍会出声失败。要覆盖它得用 GetShortPathName 的 8.3 短路径；v1 先不做。
  const dest = isAscii(primary) ? primary : isAscii(secondary) ? secondary : primary;
  if (!existsSync(join(dest, 'piper.exe'))) {
    mkdirSync(dest, { recursive: true });
    cpSync(source, dest, { recursive: true });
    return dest;
  }
  // 落点里是**上一次装的那一份**：升级换了出厂音色时它缺新模型。只补缺的 onnx，
  // 旧的一份不删 —— 用户可能还要切回去。不补的话，换音色等于让老用户的口播哑掉。
  for (const name of readdirSync(source)) {
    if (!name.endsWith('.onnx') && !name.endsWith('.onnx.json')) continue;
    if (!existsSync(join(dest, name))) cpSync(join(source, name), join(dest, name));
  }
  return dest;
}