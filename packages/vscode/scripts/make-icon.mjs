import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const SIZE = 256, SS = 4;
const cx = 128, cy = 128, R = 64, T = 16, GAP = 38;
const D2R = Math.PI / 180;
const ex = cx + R * Math.cos(GAP * D2R);
const ey1 = cy - R * Math.sin(GAP * D2R);
const ey2 = cy + R * Math.sin(GAP * D2R);
const BG = [10, 10, 10], FG = [255, 229, 0];

function isFg(x, y) {
  const dx = x - cx, dy = y - cy;
  const dist = Math.hypot(dx, dy);
  const ang = Math.atan2(-dy, dx) / D2R;
  const inArc = Math.abs(dist - R) <= T && Math.abs(ang) >= GAP;
  const cap1 = Math.hypot(x - ex, y - ey1) <= T;
  const cap2 = Math.hypot(x - ex, y - ey2) <= T;
  return inArc || cap1 || cap2;
}

// raw scanlines: filter byte 0 + RGB
const raw = Buffer.alloc(SIZE * (1 + SIZE * 3));
for (let py = 0; py < SIZE; py++) {
  const rowOff = py * (1 + SIZE * 3);
  raw[rowOff] = 0;
  for (let px = 0; px < SIZE; px++) {
    let hit = 0;
    for (let j = 0; j < SS; j++)
      for (let i = 0; i < SS; i++)
        if (isFg(px + (i + 0.5) / SS, py + (j + 0.5) / SS)) hit++;
    const c = hit / (SS * SS);
    const o = rowOff + 1 + px * 3;
    for (let k = 0; k < 3; k++) raw[o + k] = Math.round(BG[k] + (FG[k] - BG[k]) * c);
  }
}

// CRC32
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
]);
writeFileSync("icon.png", png);
console.log("wrote icon.png", png.length, "bytes");
