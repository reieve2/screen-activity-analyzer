const fs = require('fs');
const zlib = require('zlib');

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      if (c & 1) c = 0xEDB88320 ^ (c >>> 1);
      else c = c >>> 1;
    }
    table[i] = c;
  }
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function makePNG(w, h, draw) {
  function chunk(type, data) {
    const typeBuf = Buffer.from(type, 'ascii');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const raw = [];
  for (let y = 0; y < h; y++) {
    raw.push(0);
    for (let x = 0; x < w; x++) {
      const px = draw(x, y, w, h);
      raw.push(px[0], px[1], px[2], px[3]);
    }
  }
  const compressed = zlib.deflateSync(Buffer.from(raw));
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
}

function draw(x, y, w, h) {
  const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
  const dx = x - cx, dy = y - cy;
  const d = Math.sqrt(dx * dx + dy * dy);

  if (x >= 5 && x < w - 5 && y >= 8 && y < h - 4) {
    if (d < 5.5) return [20, 20, 35, 255];
    if (d < 7) return [90, 90, 110, 255];
    return [79, 70, 229, 255];
  }
  if (x >= cx - 3 && x < cx + 3 && y >= 5 && y < 9) {
    return [79, 70, 229, 255];
  }
  return [0, 0, 0, 0];
}

const png = makePNG(32, 32, draw);
fs.writeFileSync('D:\\lifecode\\screen-tracker\\assets\\icon.png', png);
console.log('Icon generated: ' + png.length + ' bytes');
