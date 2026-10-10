const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const SIZES = [16, 32, 64, 128, 256, 512, 1024];
const imagePath = size => size === 256 ? 'public/dots.png' : `public/app-icon/${size}.png`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function generate({ root = ROOT, check = false, sharp } = {}) {
  if (!sharp) sharp = createRequire(path.join(root, 'icon-tools/package.json'))('sharp');
  if (sharp.versions.sharp !== '0.35.4') throw new Error('图标生成需要 sharp 0.35.4；请先安装 icon-tools 中固定的依赖');
  const original = fs.readFileSync(path.join(root, 'artwork/ghost-original.png'));
  const mask = fs.readFileSync(path.join(root, 'artwork/macos-style-mask.svg'));
  const metadata = await sharp(original).metadata();
  if (metadata.width !== 1024 || metadata.height !== 1024 || metadata.format !== 'png') throw new Error('选定的原图必须为 1024 × 1024 PNG');
  const art = await sharp(original).resize(824, 824).toBuffer();
  const full = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: art, left: 100, top: 100 }]).png().toBuffer();
  const master = await sharp(full).composite([{ input: await sharp(mask).png().toBuffer(), blend: 'dest-in' }]).png().toBuffer();
  const images = [];
  for (const size of SIZES) {
    const png = size === 1024 ? master : await sharp(master).resize(size, size).png().toBuffer();
    const pixels = await sharp(png).ensureAlpha().raw().toBuffer();
    const relativePath = imagePath(size);
    images.push({ size, path: relativePath, sha256: hash(png), pixelSha256: hash(pixels) });
    if (check) {
      const current = fs.readFileSync(path.join(root, relativePath));
      const existing = await sharp(current).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      if (existing.info.width !== size || existing.info.height !== size || !pixels.equals(existing.data)) throw new Error(`图标像素与来源不一致：${relativePath}`);
    } else {
      fs.mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
      fs.writeFileSync(path.join(root, relativePath), png);
    }
  }
  const manifest = {
    artwork: 'Ghost — ipaslogo.com',
    original: 'artwork/ghost-original.png',
    originalSha256: hash(original),
    mask: 'artwork/macos-style-mask.svg',
    maskSha256: hash(mask),
    maskGenerator: { name: 'figma-squircle', version: '1.1.0', width: 824, height: 824, cornerRadius: 184, cornerSmoothing: 0.6, preserveSmoothing: true, inset: 100, canvas: 1024 },
    renderer: { sharp: sharp.versions.sharp, vips: sharp.versions.vips, rsvg: sharp.versions.rsvg },
    images,
  };
  if (check) {
    const current = JSON.parse(fs.readFileSync(path.join(root, 'artwork/icon-manifest.json'), 'utf8'));
    if (current.originalSha256 !== manifest.originalSha256 || current.maskSha256 !== manifest.maskSha256 || current.images.length !== images.length || images.some((item, index) => item.pixelSha256 !== current.images[index].pixelSha256 || item.path !== current.images[index].path || item.size !== current.images[index].size)) throw new Error('图标来源或像素清单不一致');
  } else fs.writeFileSync(path.join(root, 'artwork/icon-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
module.exports = { generate, imagePath, SIZES };
if (require.main === module) generate({ check: process.argv.includes('--check') }).then(manifest => console.log(`已${process.argv.includes('--check') ? '验证' : '生成'} ${manifest.images.length} 个图标尺寸`)).catch(error => { console.error(error.message); process.exitCode = 1; });
