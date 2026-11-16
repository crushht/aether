// Generates the desktop icon without any image dependency.
//
//   node scripts/make-icon.mjs
//   → build/icon.png (512×512) and build/icon.ico (PNG-compressed, 256×256)
//
// The mark: a rounded square with the product gradient and the same diagonal
// three-stripe glyph the app uses as its logo.

import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Rounded-rect coverage with 1px antialiasing. */
function roundedCoverage(x, y, size, radius) {
  const inset = size * 0.055;
  const left = inset;
  const top = inset;
  const right = size - inset;
  const bottom = size - inset;
  const cx = Math.min(Math.max(x, left + radius), right - radius);
  const cy = Math.min(Math.max(y, top + radius), bottom - radius);
  const distance = Math.hypot(x - cx, y - cy);
  return Math.max(0, Math.min(1, radius + 0.5 - distance));
}

function render(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const radius = size * 0.22;
  // diagonal glyph: three strokes inside the rounded square
  const strokes = [
    [0.26, 0.62, 0.62, 0.26],
    [0.36, 0.74, 0.76, 0.34],
    [0.5, 0.84, 0.86, 0.48],
  ].map(([ax, ay, bx, by]) => [ax * size, ay * size, bx * size, by * size]);
  const strokeWidth = size * 0.055;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      const coverage = roundedCoverage(px, py, size, radius);
      const index = (y * size + x) * 4;
      if (coverage <= 0) {
        rgba[index + 3] = 0;
        continue;
      }

      // gradient: light lavender at the top, indigo at the bottom
      const t = py / size;
      let r = Math.round(154 + (94 - 154) * t);
      let g = Math.round(164 + (106 - 164) * t);
      let b = Math.round(255 + (210 - 255) * t);

      // glyph
      let ink = 0;
      for (const [ax, ay, bx, by] of strokes) {
        const d = segmentDistance(px, py, ax, ay, bx, by);
        ink = Math.max(ink, Math.max(0, Math.min(1, strokeWidth / 2 + 0.5 - d)));
      }
      if (ink > 0) {
        r = Math.round(r + (255 - r) * ink * 0.92);
        g = Math.round(g + (255 - g) * ink * 0.92);
        b = Math.round(b + (255 - b) * ink * 0.92);
      }

      rgba[index] = r;
      rgba[index + 1] = g;
      rgba[index + 2] = b;
      rgba[index + 3] = Math.round(255 * coverage);
    }
  }

  return encodePng(size, size, rgba);
}

/** ICO container with one PNG-compressed 256×256 image. */
function encodeIco(png, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // image count
  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size;
  entry[1] = size >= 256 ? 0 : size;
  entry[2] = 0; // palette
  entry[3] = 0;
  entry.writeUInt16LE(1, 4); // colour planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12); // offset
  return Buffer.concat([header, entry, png]);
}

await mkdir('build', { recursive: true });
const large = render(512);
await writeFile(path.join('build', 'icon.png'), large);
const small = render(256);
await writeFile(path.join('build', 'icon.ico'), encodeIco(small, 256));
console.log('✓ build/icon.png (512) and build/icon.ico (256) written');
