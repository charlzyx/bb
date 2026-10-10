import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';

export const iconSizes = [16, 32, 64, 128, 256, 512, 1024];
export const iconPath = (size: number) => size === 256 ? 'public/dots.png' : `public/app-icon/${size}.png`;
export const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function paeth(left: number, up: number, upperLeft: number) {
  const value = left + up - upperLeft;
  const a = Math.abs(value - left), b = Math.abs(value - up), c = Math.abs(value - upperLeft);
  return a <= b && a <= c ? left : b <= c ? up : upperLeft;
}
export function decodeIcon(bytes: Buffer) {
  assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const compressed: Buffer[] = [];
  let width = 0, height = 0, ended = false;
  for (let offset = 8; offset < bytes.length;) {
    assert.ok(offset + 12 <= bytes.length);
    const length = bytes.readUInt32BE(offset);
    assert.ok(offset + length + 12 <= bytes.length);
    const kind = bytes.toString('ascii', offset + 4, offset + 8);
    assert.equal(bytes.readUInt32BE(offset + 8 + length), crc32(bytes.subarray(offset + 4, offset + 8 + length)), `${kind} checksum`);
    if (kind === 'IHDR') {
      assert.equal(offset, 8); assert.equal(length, 13);
      width = bytes.readUInt32BE(offset + 8); height = bytes.readUInt32BE(offset + 12);
      assert(width > 0 && width <= 1024 && height === width);
      assert.deepEqual([...bytes.subarray(offset + 16, offset + 21)], [8, 6, 0, 0, 0]);
    } else if (kind === 'IDAT') compressed.push(bytes.subarray(offset + 8, offset + 8 + length));
    else if (kind === 'IEND') { assert.equal(length, 0); assert.equal(offset + 12, bytes.length); ended = true; }
    else assert(/^[a-z]/.test(kind), `Unexpected critical PNG chunk ${kind}`);
    offset += length + 12;
  }
  assert(ended && compressed.length > 0);
  const stride = width * 4;
  const rows = inflateSync(Buffer.concat(compressed), { maxOutputLength: (stride + 1) * height });
  assert.equal(rows.length, (stride + 1) * height);
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = rows[y * (stride + 1)]; assert(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x;
      const left = x >= 4 ? pixels[index - 4] : 0;
      const up = y > 0 ? pixels[index - stride] : 0;
      const upperLeft = y > 0 && x >= 4 ? pixels[index - stride - 4] : 0;
      const prediction = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2) : paeth(left, up, upperLeft);
      pixels[index] = (rows[y * (stride + 1) + x + 1] + prediction) & 255;
    }
  }
  return { width, height, pixels };
}
export function checkOpticalBounds(size: number, pixels: Buffer) {
  const alpha = (x: number, y: number) => pixels[(y * size + x) * 4 + 3];
  for (const [x, y] of [[0, 0], [0, size - 1], [size - 1, 0], [size - 1, size - 1]]) assert.equal(alpha(x, y), 0);
  for (let position = 0; position < size; position++) {
    for (const value of [alpha(position, 0), alpha(position, size - 1), alpha(0, position), alpha(size - 1, position)]) assert(value <= 1, 'Only negligible downsampling ringing may reach the outer edge');
  }
  for (const vertical of [false, true]) {
    const visible = Array.from({ length: size }, (_, position) => position).filter(position => (vertical ? alpha(size / 2, position) : alpha(position, size / 2)) > 127);
    assert(Math.abs(visible[0] - size * 100 / 1024) <= 1);
    assert.equal(visible.at(-1), size - 1 - visible[0]);
  }
  assert.equal(alpha(size / 2, size / 2), 255);
}
