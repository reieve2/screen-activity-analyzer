// Icon generation script: SVG -> PNG -> ICO
// Usage: node scripts/gen-icon.js
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const toIco = require('to-ico');

const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const SVG_PATH = path.join(ASSETS_DIR, 'icon.svg');
const PNG_PATH = path.join(ASSETS_DIR, 'icon.png');
const ICO_PATH = path.join(ASSETS_DIR, 'icon.ico');
const DIST_ICO_PATH = path.join(__dirname, '..', 'dist', 'ScreenTracker', 'icon.ico');

const ICO_SIZES = [16, 32, 48, 64, 128, 256];

async function main() {
  console.log('Reading SVG:', SVG_PATH);
  const svgBuffer = fs.readFileSync(SVG_PATH);

  // 1. Render SVG to 1024x1024 PNG with high density for anti-aliasing
  console.log('Rendering SVG to 1024x1024 PNG...');
  await sharp(svgBuffer, { density: 384 })
    .resize(1024, 1024, { fit: 'contain' })
    .png({ compressionLevel: 9, quality: 100 })
    .toFile(PNG_PATH);
  console.log('PNG saved:', PNG_PATH);

  // 2. Generate multiple PNG sizes for the ICO
  console.log('Generating ICO sizes:', ICO_SIZES.join(', '));
  const pngBuffers = [];
  for (const size of ICO_SIZES) {
    const buf = await sharp(PNG_PATH)
      .resize(size, size, { fit: 'contain' })
      .png({ compressionLevel: 9, quality: 100 })
      .toBuffer();
    pngBuffers.push(buf);
  }

  // 3. Combine into a multi-size ICO
  console.log('Combining into multi-size ICO...');
  const icoBuffer = await toIco(pngBuffers);
  fs.writeFileSync(ICO_PATH, icoBuffer);
  console.log('ICO saved:', ICO_PATH);

  // 4. Copy ICO to dist folder
  const distDir = path.dirname(DIST_ICO_PATH);
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
    console.log('Created dist dir:', distDir);
  }
  fs.copyFileSync(ICO_PATH, DIST_ICO_PATH);
  console.log('ICO copied to dist:', DIST_ICO_PATH);

  // Report file sizes
  const pngSize = fs.statSync(PNG_PATH).size;
  const icoSize = fs.statSync(ICO_PATH).size;
  const distIcoSize = fs.statSync(DIST_ICO_PATH).size;
  console.log('\n=== Results ===');
  console.log(`PNG: ${PNG_PATH} (${pngSize} bytes)`);
  console.log(`ICO: ${ICO_PATH} (${icoSize} bytes)`);
  console.log(`Dist ICO: ${DIST_ICO_PATH} (${distIcoSize} bytes)`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
