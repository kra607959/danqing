// 零依赖 PNG 编码（灰度 8 位），给合成样本的总览图用。
import zlib from 'node:zlib';

const TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// pixels：Uint8Array，长 w*h，0 黑 255 白
export function encodeGray(w, h, pixels) {
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0;
    for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = pixels[y * w + x];
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// 把若干张 size×size 的墨图（0..1）拼成 rows×cols 的总览，格间留白
export function sheet(tiles, cols, size, gap = 4) {
  const rows = Math.ceil(tiles.length / cols);
  const W = cols * (size + gap) + gap, H = rows * (size + gap) + gap;
  const px = new Uint8Array(W * H).fill(255);
  tiles.forEach((img, k) => {
    if (!img) return;
    const ox = gap + (k % cols) * (size + gap), oy = gap + Math.floor(k / cols) * (size + gap);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      px[(oy + y) * W + ox + x] = Math.round(255 * (1 - Math.min(1, img[y * size + x])));
    }
    // 淡灰的格框
    for (let i = -1; i <= size; i++) {
      for (const [x, y] of [[ox + i, oy - 1], [ox + i, oy + size], [ox - 1, oy + i], [ox + size, oy + i]]) {
        if (x >= 0 && y >= 0 && x < W && y < H) px[y * W + x] = 215;
      }
    }
  });
  return encodeGray(W, H, px);
}
