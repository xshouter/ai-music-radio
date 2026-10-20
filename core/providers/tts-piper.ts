import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { TtsProvider, TtsRequest, TtsResult } from '../../shared/ports.ts';

export interface PiperTtsOptions {
  /** 运行时目录：piper.exe、espeak-ng-data/ 和 <voice>.onnx 都在这一层。必须纯 ASCII（见下）。 */
  dir: string;
  /** 音色缺省值。req.voice 为空时用它。 */
  voice?: string;
  id?: string;
}

/**
 * piper 的 espeak-ng 用 fopen 读自己的数据目录：路径含非 ASCII 时直接 `Illegal byte sequence`，
 * 然后**静默产出 0 字节音频**（在中文路径下实测过）。组装层（main/tts-runtime.ts）负责把运行时
 * 摆到 ASCII 目录；这里再断言一次，免得哪天组装层被人改坏。
 */
const assertAscii = (dir: string): void => {
  if (!/^[\x00-\x7f]*$/.test(dir)) throw new Error('piper 运行时目录必须是纯 ASCII 路径，收到：' + dir);
};

/**
 * Piper（MIT，离线神经 TTS）。一次一句：文本喂 stdin，让它把 WAV 写到一个临时文件，读回来。
 *
 * 它是 `format: 'wav'` 的 provider —— core/tts.ts 按 provider 声明的容器决定缓存后缀、
 * `/tts/<key>.<ext>` 的路由与时长解析器。不引任何依赖：spawn 一个 exe 就完了。
 * 运行时与模型随安装包发（vendor/piper → resources/piper），所以开箱就有声音，不需要任何 key。
 */
export function createPiperTts(options: PiperTtsOptions): TtsProvider {
  const dir = options.dir;
  const exe = join(dir, 'piper.exe');
  const espeakData = join(dir, 'espeak-ng-data');
  const voiceDefault = options.voice ?? 'en_GB-alan-medium';
  let seq = 0;

  return {
    id: options.id ?? 'piper',
    format: 'wav' as const,
    synthesize(req: TtsRequest): Promise<TtsResult> {
      assertAscii(dir);
      if (!existsSync(exe)) return Promise.reject(new Error('找不到 piper.exe：' + exe));
      const voice = req.voice === '' ? voiceDefault : req.voice;
      const model = join(dir, voice + '.onnx');
      if (!existsSync(model)) return Promise.reject(new Error('找不到音色模型：' + model));

      seq += 1;
      // 输出也写在运行时目录里：piper 写文件同样走 fopen，落到非 ASCII 路径一样废。
      const out = join(dir, '.say-' + process.pid + '-' + seq + '.wav');
      const args = ['-m', model, '-f', out, '--espeak_data', espeakData, '-q'];

      return new Promise<TtsResult>((resolve, reject) => {
        const child = spawn(exe, args, { cwd: dir, windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
        let stderr = '';
        child.stderr.on('data', (chunk: Buffer) => {
          if (stderr.length < 2000) stderr += chunk.toString('utf8');
        });
        child.on('error', reject);
        child.on('close', (code) => {
          const drop = (): void => {
            try {
              rmSync(out, { force: true });
            } catch {
              // 临时文件，删不掉就算了。
            }
          };
          if (code !== 0) {
            drop();
            reject(new Error('piper 退出码 ' + code + '：' + stderr.trim().slice(0, 300)));
            return;
          }
          try {
            const audio = readFileSync(out);
            drop();
            if (audio.byteLength === 0) reject(new Error('piper 产出了空音频'));
            else resolve({ audio, contentType: 'audio/wav' });
          } catch (cause: unknown) {
            drop();
            reject(cause instanceof Error ? cause : new Error(String(cause)));
          }
        });
        child.stdin.end(req.text + '\n');
      });
    },
  };
}