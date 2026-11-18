import { deflateSync } from 'node:zlib';

// A generated synthetic receipt, with no external image service or customer data.
const glyphs = {
  ' ': '00000000000000000000000000000000000',
  C: '01111100001000010000100001000001111',
  I: '11111001000010000100001000010011111',
  R: '11110100011000111110101001001010001',
  E: '11111100001000011110100001000011111',
  P: '11110100011000111110100001000010000',
  T: '11111001000010000100001000010000100',
  J: '00111000100001000010000101001001100',
  U: '10001100011000110001100011000101110',
  O: '01110100011000110001100011000101110',
  N: '10001110011010110011100011000110001',
  G: '01111100001000010111100011000101111',
  A: '01110100011000111111100011000110001',
  X: '10001100010101000100010101000110001',
  L: '10000100001000010000100001000011111',
  0: '01110100011001110101110011000101110',
  1: '00100011000010000100001000010001110',
  2: '01110100010000100010001000100011111',
  3: '11110000010000101110000010000111110',
};
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const tag = Buffer.from(type),
    size = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  size.writeUInt32BE(bytes.length);
  crc.writeUInt32BE(crc32(Buffer.concat([tag, bytes])));
  return Buffer.concat([size, tag, bytes, crc]);
}
export function receiptPng() {
  const width = 480,
    height = 640,
    stride = width * 3 + 1;
  const data = Buffer.alloc(height * stride, 255);
  for (let y = 0; y < height; y++) data[y * stride] = 0;
  ['CI RECEIPT', 'JUICE 100', 'ONIGIRI 200', 'TAX 30', 'TOTAL 330'].forEach((line, row) => {
    [...line].forEach((letter, column) => {
      [...glyphs[letter]].forEach((pixel, i) => {
        if (pixel === '0') return;
        for (let dy = 0; dy < 5; dy++)
          for (let dx = 0; dx < 5; dx++) {
            const x = 35 + column * 30 + (i % 5) * 5 + dx;
            const y = 45 + row * 100 + Math.floor(i / 5) * 5 + dy;
            data.fill(20, y * stride + 1 + x * 3, y * stride + 1 + x * 3 + 3);
          }
      });
    });
  });
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(data)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
