// 의존성 없이 순수 Node로 앱 아이콘(PNG)을 생성한다.
// 사용: npm run icon  →  assets/icon.png 와 build/icon.png 생성
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const SIZE = 1024;
const BG = [79, 70, 229]; // indigo
const FG = [255, 255, 255];

// 라운드 사각형 내부 판정 (중앙 기준, 크기 s, 반지름 r)
function inRoundedRect(x, y, s, r) {
  const min = (SIZE - s) / 2;
  const max = SIZE - min;
  if (x < min || x > max || y < min || y > max) return false;
  const cx = clamp(x, min + r, max - r);
  const cy = clamp(y, min + r, max - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function pixel(x, y) {
  // 배경: 전체 라운드 사각형
  if (!inRoundedRect(x, y, SIZE, 224)) return [0, 0, 0, 0];
  // 흰색 프레임(뷰파인더) + 안쪽은 배경색 유지
  const ringOuter = inRoundedRect(x, y, 560, 120);
  const ringInner = inRoundedRect(x, y, 448, 64);
  if (ringOuter && !ringInner) return FG;
  // 중앙 점
  const c = SIZE / 2;
  const dx = x - c;
  const dy = y - c;
  if (dx * dx + dy * dy <= 80 * 80) return FG;
  return BG;
}

// ---- 최소 PNG 인코더 ----
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
  for (let y = 0; y < SIZE; y++) {
    const row = y * (SIZE * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < SIZE; x++) {
      const [r, g, b, a] = pixels[y * SIZE + x];
      raw.writeUInt8(r, row + 1 + x * 4);
      raw.writeUInt8(g, row + 2 + x * 4);
      raw.writeUInt8(b, row + 3 + x * 4);
      raw.writeUInt8(a, row + 4 + x * 4);
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const pixels = new Array(SIZE * SIZE);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    pixels[y * SIZE + x] = pixel(x, y);
  }
}

const png = encodePng(pixels);
const assetsDir = path.join(__dirname, "..", "assets");
const buildDir = path.join(__dirname, "..", "build");
fs.mkdirSync(assetsDir, { recursive: true });
fs.mkdirSync(buildDir, { recursive: true });
fs.writeFileSync(path.join(assetsDir, "icon.png"), png);
fs.writeFileSync(path.join(buildDir, "icon.png"), png);
console.log("아이콘 생성 완료: assets/icon.png, build/icon.png");
