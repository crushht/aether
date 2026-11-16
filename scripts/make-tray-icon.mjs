#!/usr/bin/env node
/**
 * Generates `desktop/tray.png` (32x32) — a small indigo disc with a light ring.
 * Hand-rolled PNG so the repo needs no image tooling and no binary blob to
 * review: run this file to regenerate it.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const SIZE = 32;
const CENTER = (SIZE - 1) / 2;

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

// transparent background, indigo disc, light inner ring, solid centre dot
const pixels = Buffer.alloc(SIZE * SIZE * 4);
const disc = 15.2;
const ringOuter = 10.4;
const ringInner = 8.2;
const dot = 3.4;

for (let y = 0; y < SIZE; y += 1) {
  for (let x = 0; x < SIZE; x += 1) {
    const dx = x - CENTER;
    const dy = y - CENTER;
    const distance = Math.hypot(dx, dy);
    const offset = (y * SIZE + x) * 4;
    let rgba = [0, 0, 0, 0];

    if (distance <= dot) rgba = [255, 255, 255, 255];
    else if (distance <= ringOuter && distance >= ringInner) rgba = [235, 238, 255, 235];
    else if (distance <= disc) rgba = [94, 106, 210, 255];

    pixels[offset] = rgba[0];
    pixels[offset + 1] = rgba[1];
    pixels[offset + 2] = rgba[2];
    pixels[offset + 3] = rgba[3];
  }
}

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y += 1) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter: none
  pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const target = path.join(process.cwd(), 'desktop', 'tray.png');
writeFileSync(target, png);
console.log(`wrote ${target} (${png.length} bytes)`);
