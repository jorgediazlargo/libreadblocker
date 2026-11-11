// Genera los iconos PNG (sin dependencias): cuadrado redondeado con una malla de tamiz.
//   node scripts/make-icons.ts
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size: number, pixel: (x: number, y: number) => [number, number, number, number]) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      raw.set([r, g, b, a], y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BG = [47, 111, 79];
const FG = [255, 255, 255];
const SS = 4; // supermuestreo para suavizar bordes

/** 0 = fuera, 1 = fondo, 2 = malla blanca. Coordenadas normalizadas 0..1. */
function shape(u: number, v: number): number {
  const r = 0.22;
  const cx = Math.min(Math.max(u, r), 1 - r);
  const cy = Math.min(Math.max(v, r), 1 - r);
  if ((u - cx) ** 2 + (v - cy) ** 2 > r * r) return 0;
  // Círculo del tamiz con malla de 3 líneas en cada dirección.
  const d = Math.hypot(u - 0.5, v - 0.5);
  if (d > 0.34) return 1;
  if (d > 0.27) return 2;
  const grid = [0.385, 0.5, 0.615];
  const w = 0.028;
  if (grid.some((g) => Math.abs(u - g) < w) || grid.some((g) => Math.abs(v - g) < w)) return 2;
  return 1;
}

for (const size of [16, 32, 48, 128]) {
  const buf = png(size, (x, y) => {
    let bg = 0, fg = 0;
    for (let i = 0; i < SS; i++)
      for (let j = 0; j < SS; j++) {
        const s = shape((x + (i + 0.5) / SS) / size, (y + (j + 0.5) / SS) / size);
        if (s === 1) bg++;
        else if (s === 2) fg++;
      }
    const n = SS * SS, a = (bg + fg) / n;
    if (a === 0) return [0, 0, 0, 0];
    const t = fg / (bg + fg);
    const mix = (k: number) => Math.round(BG[k]! * (1 - t) + FG[k]! * t);
    return [mix(0), mix(1), mix(2), Math.round(a * 255)];
  });
  writeFileSync(new URL(`../static/icons/${size}.png`, import.meta.url), buf);
}
console.log('iconos generados');
