// Renders web/icon-192.png and web/icon-512.png: the logo mark from web/logo.svg in white on graphite.
// Full-bleed background, mark inside the central safe zone, so the 512 icon also works as a maskable icon.
// Usage: node make-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [28, 28, 30], FG = [255, 255, 255];
const svg = readFileSync(new URL('../web/logo.svg', import.meta.url), 'utf8');
const [, vw, vh] = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).map(Number);
const d = svg.match(/ d="([^"]+)"/)[1];
// The tracer writes straight-edged loops only: "M x y x y ... Z".
const loops = d.split('M').slice(1).map((part) => {
  const n = part.replace('Z', '').trim().split(/\s+/).map(Number);
  const pts = [];
  for (let i = 0; i < n.length; i += 2) pts.push([n[i], n[i + 1]]);
  return pts;
});
const edges = loops.flatMap((l) => l.map((p, i) => [p, l[(i + 1) % l.length]]));

// Coverage of one row of samples (even-odd fill), in mark coordinates.
function spans(y) {
  const xs = [];
  for (const [[x1, y1], [x2, y2]] of edges) {
    if ((y1 > y) !== (y2 > y)) xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
  }
  return xs.sort((a, b) => a - b);
}
const insideAt = (xs, x) => { let n = 0; for (const v of xs) { if (v < x) n++; else break; } return n % 2 === 1; };

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function png(size) {
  const ss = 4;
  const markW = size * (300 / 512), scale = markW / vw;          // same proportions as web/icon.svg
  const ox = (size - markW) / 2, oy = (size - vh * scale) / 2;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    const rowSpans = Array.from({ length: ss }, (_, sy) => spans((y + (sy + 0.5) / ss - oy) / scale));
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) if (insideAt(rowSpans[sy], (x + (sx + 0.5) / ss - ox) / scale)) hits++;
      }
      const t = hits / (ss * ss), o = y * (size * 3 + 1) + 1 + x * 3;
      for (let k = 0; k < 3; k++) raw[o + k] = Math.round(BG[k] + (FG[k] - BG[k]) * t);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

for (const size of [192, 512]) {
  writeFileSync(new URL(`../web/icon-${size}.png`, import.meta.url), png(size));
  console.log(`web/icon-${size}.png`);
}
