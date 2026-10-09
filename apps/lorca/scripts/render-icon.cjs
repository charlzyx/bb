const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { deflateSync } = require('node:zlib');

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(bytes.length); header.write(type, 4);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([header.subarray(4), bytes])));
  return Buffer.concat([header, bytes, checksum]);
}
function renderIcon(svg) {
  if (!/viewBox="0 0 32 32"/.test(svg)) throw new Error('图标必须使用 32 × 32 画布');
  const circles = [...svg.matchAll(/<circle\s+cx="([\d.]+)"\s+cy="([\d.]+)"\s+r="([\d.]+)"\s*\/>/g)].map(match => match.slice(1).map(Number));
  if (circles.length !== 4 || circles.flat().some(value => !Number.isFinite(value) || value < 0 || value > 32)) throw new Error('图标必须包含四个有效圆点');
  const size = 256;
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let coverage = 0;
    let tile = 0;
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
      const px = (x + (sx + 0.5) / 4) * 32 / size;
      const py = (y + (sy + 0.5) / 4) * 32 / size;
      const dx = Math.max(5 - px, 0, px - 27);
      const dy = Math.max(5 - py, 0, py - 27);
      if (dx * dx + dy * dy <= 25) tile++;
      if (circles.some(([cx, cy, radius]) => (px - cx) ** 2 + (py - cy) ** 2 <= radius ** 2)) coverage++;
    }
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    for (let channel = 0; channel < 3; channel++) rows[offset + channel] = Math.round([243, 243, 239][channel] + ([36, 36, 34][channel] - [243, 243, 239][channel]) * coverage / 16);
    rows[offset + 3] = Math.round(tile * 255 / 16);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
if (require.main === module) writeFileSync(path.resolve(__dirname, '../public/dots.png'), renderIcon(readFileSync(path.resolve(__dirname, '../public/dots.svg'), 'utf8')));
module.exports = { renderIcon };
