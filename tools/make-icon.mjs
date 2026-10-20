#!/usr/bin/env node
// 生成应用图标：assets/icon.png + assets/icon.ico（多尺寸）。
// 零依赖（zlib 是内置的）—— 一个图标不值得拉一条图像工具链。
//
// 图形与界面同源：点阵字体（Doto）的点 + 强调绿 + 面板底色。点阵组成一个向右的播放三角。
//
//   node tools/make-icon.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PANEL = [23, 20, 29];       // --panel #17141d
const RING = [49, 49, 58];        // --pill-line #31313a
const ACCENT = [41, 255, 184];    // --accent #29ffb8

// 4 列 × 5 行的点阵三角：宽高比 0.8，接近播放键的经典比例。1 = 点。
const GLYPH = [
  [1, 0, 0, 0],
  [1, 1, 1, 0],
  [1, 1, 1, 1],
  [1, 1, 1, 0],
  [1, 0, 0, 0],
];

// 字形不是满格的：先量出墨迹占了哪些行列，画的时候按**墨迹**居中。
const INK = (() => {
  let minCol = GLYPH[0].length;
  let maxCol = -1;
  let minRow = GLYPH.length;
  let maxRow = -1;
  GLYPH.forEach((line, row) => {
    line.forEach((value, col) => {
      if (value !== 1) return;
      minCol = Math.min(minCol, col);
      maxCol = Math.max(maxCol, col);
      minRow = Math.min(minRow, row);
      maxRow = Math.max(maxRow, row);
    });
  });
  return { cols: maxCol - minCol + 1, rows: maxRow - minRow + 1, minCol, minRow };
})();

const SS = 4; // 超采样倍数：形状先按 4× 画再盒式降采样，边缘才不毛。

/** 圆角矩形 SDF：<=0 在内部。 */
const roundedRect = (x, y, size, radius) => {
  const half = size / 2;
  const dx = Math.abs(x - half) - (half - radius);
  const dy = Math.abs(y - half) - (half - radius);
  const ox = Math.max(dx, 0);
  const oy = Math.max(dy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(dx, dy), 0) - radius;
};

/** 按目标尺寸画一张 RGBA。 */
const render = (size) => {
  const n = size * SS;
  const px = new Uint8Array(n * n * 4);
  const radius = size * 0.225 * SS;
  const cell = (size * 0.5 * SS) / INK.cols; // 墨迹占画布宽 50%
  const gridX = (n - INK.cols * cell) / 2 - INK.minCol * cell;
  const gridY = (n - INK.rows * cell) / 2 - INK.minRow * cell;
  // 16px 下点会被降采样抹平：小尺寸改用更胖的点，形状还认得出。
  const dot = cell * (size <= 20 ? 0.5 : 0.34);
  const ringW = Math.max(1.2, size * 0.012) * SS;

  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      const d = roundedRect(cx, cy, n, radius);
      if (d > 0) continue; // 圆角外保持透明
      const edge = -d < ringW; // 内描边
      let color = edge ? RING : PANEL;

      const gx = (cx - gridX) / cell;
      const gy = (cy - gridY) / cell;
      const col = Math.floor(gx);
      const row = Math.floor(gy);
      if (col >= 0 && col < GLYPH[0].length && row >= 0 && row < GLYPH.length && GLYPH[row][col] === 1) {
        const dxc = cx - (gridX + (col + 0.5) * cell);
        const dyc = cy - (gridY + (row + 0.5) * cell);
        if (Math.hypot(dxc, dyc) <= dot) color = ACCENT;
      }

      const at = (y * n + x) * 4;
      px[at] = color[0];
      px[at + 1] = color[1];
      px[at + 2] = color[2];
      px[at + 3] = 255;
    }
  }

  // 盒式降采样
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const at = ((y * SS + sy) * n + (x * SS + sx)) * 4;
          r += px[at];
          g += px[at + 1];
          b += px[at + 2];
          a += px[at + 3];
        }
      }
      const k = SS * SS;
      const at = (y * size + x) * 4;
      out[at] = Math.round(r / k);
      out[at + 1] = Math.round(g / k);
      out[at + 2] = Math.round(b / k);
      out[at + 3] = Math.round(a / k);
    }
  }
  return out;
};

// ── PNG ─────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};

const pngOf = (size, rgba) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 6; // 真彩 + alpha
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // 过滤器 0
    Buffer.from(rgba.subarray(y * size * 4, (y + 1) * size * 4)).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

// ── ICO：每个尺寸一张 PNG（Vista 起合法），小尺寸自己渲染才不糊 ──────────────
const icoOf = (entries) => {
  const dir = Buffer.alloc(6 + entries.length * 16);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(entries.length, 4);
  let offset = dir.length;
  entries.forEach((entry, index) => {
    const at = 6 + index * 16;
    dir[at] = entry.size >= 256 ? 0 : entry.size;
    dir[at + 1] = entry.size >= 256 ? 0 : entry.size;
    dir.writeUInt16LE(1, at + 4);
    dir.writeUInt16LE(32, at + 6);
    dir.writeUInt32LE(entry.png.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += entry.png.length;
  });
  return Buffer.concat([dir, ...entries.map((entry) => entry.png)]);
};

const SIZES = [16, 24, 32, 48, 64, 128, 256];
mkdirSync('assets', { recursive: true });
const entries = SIZES.map((size) => ({ size, png: pngOf(size, render(size)) }));
writeFileSync(join('assets', 'icon.png'), pngOf(256, render(256)));
writeFileSync(join('assets', 'icon.ico'), icoOf(entries));
console.log('✓ assets/icon.png (256) + assets/icon.ico (' + SIZES.join(' / ') + ')');

// 自检：墨迹（强调色的点）必须落在画布正中，且不贴边 —— 否则小尺寸下会歪。
const inkBox = (size) => {
  const px = render(size);
  let x0 = size;
  let y0 = size;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const at = (y * size + x) * 4;
      if (px[at + 3] > 0 && px[at + 1] > 195 && px[at] < 100) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }
  return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
};
for (const size of SIZES) {
  const box = inkBox(size);
  if (box.x1 < 0 || box.y1 < 0) throw new Error('图标 ' + size + 'px 完全没有墨迹');
  const off = Math.abs(box.cx - (size - 1) / 2) + Math.abs(box.cy - (size - 1) / 2);
  console.log('  ' + String(size).padStart(3) + '  墨迹 x[' + box.x0 + ',' + box.x1 + '] y[' + box.y0 + ',' + box.y1 + ']  中心偏移 ' + off.toFixed(1));
  if (off > size * 0.12) throw new Error('图标墨迹偏离画布中心：' + size + 'px 偏 ' + off);
  if (box.x0 < size * 0.1 || box.y0 < size * 0.1 || box.x1 > size * 0.9 || box.y1 > size * 0.9) {
    throw new Error('图标墨迹太贴边：' + size + 'px');
  }
}