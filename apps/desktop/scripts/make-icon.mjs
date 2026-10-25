// Generates build-resources/icon.png (256x256): a blue rounded square with a white barcode and a
// check mark. Pure Node (zlib PNG encoder), so no image tools or downloads are needed.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const S = 256;
const px = Buffer.alloc(S * S * 4);
const set = (x, y, [r, g, b, a]) => {
  const i = (y * S + x) * 4;
  px[i] = r;
  px[i + 1] = g;
  px[i + 2] = b;
  px[i + 3] = a;
};
const blue = [29, 78, 216, 255];
const white = [255, 255, 255, 255];
const green = [74, 222, 128, 255];
const R = 48;
for (let y = 0; y < S; y++)
  for (let x = 0; x < S; x++) {
    const dx = Math.max(R - x, 0, x - (S - 1 - R));
    const dy = Math.max(R - y, 0, y - (S - 1 - R));
    if (dx * dx + dy * dy <= R * R) set(x, y, blue);
  }
// barcode bars
const bars = [3, 1, 2, 1, 1, 3, 1, 2, 2, 1, 3, 1, 1, 2];
let x = 56;
bars.forEach((w, i) => {
  const width = w * 5;
  if (i % 2 === 0)
    for (let xx = x; xx < x + width; xx++) for (let y = 60; y < 150; y++) set(xx, y, white);
  x += width;
});
// check mark
const line = (x0, y0, x1, y1, t) => {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let k = 0; k <= n; k++) {
    const cx = x0 + ((x1 - x0) * k) / n,
      cy = y0 + ((y1 - y0) * k) / n;
    for (let yy = -t; yy <= t; yy++)
      for (let xx = -t; xx <= t; xx++)
        if (xx * xx + yy * yy <= t * t) set(Math.round(cx + xx), Math.round(cy + yy), green);
  }
};
line(80, 190, 112, 220, 9);
line(112, 220, 180, 160, 9);

const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8;
ihdr[9] = 6;
mkdirSync('build-resources', { recursive: true });
writeFileSync(
  'build-resources/icon.png',
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]),
);
console.log('build-resources/icon.png written');
