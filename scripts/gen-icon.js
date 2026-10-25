// 의존성 없이 순수 Node로 앱 아이콘(PNG)을 생성한다.
// 사용: npm run icon  →  assets/icon.png 와 build/icon.png 생성
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const SIZE = 1024;

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// ---- 부드러운 가장자리를 위한 거리 함수들 ----

// 점-선분 거리
function sdSeg(px, py, ax, ay, bx, by) {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay), 0, 1);
  return Math.hypot(pax - bax * h, pay - bay * h);
}

// 라운드 양끝 선분(캡슐)의 부호거리
function sdCapsule(px, py, ax, ay, bx, by, r) {
  return sdSeg(px, py, ax, ay, bx, by) - r;
}

// 라운드 사각형의 부호거리
function sdRoundRect(px, py, cx, cy, w, h, r) {
  const qx = Math.abs(px - cx) - (w / 2 - r);
  const qy = Math.abs(py - cy) - (h / 2 - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(ax, ay) - r;
}

// 부호거리 → 0~1 커버리지 (1px 페더로 안티에일리어싱)
function cov(d) {
  return clamp(0.5 - d, 0, 1);
}

// ---- 디자인 파라미터 ----
const CORNER = 300; // 중앙에서 뷰파인더 코너까지 거리
const ARM = 190; // 브래킷 팔 길이
const CAP_R = 25; // 브래킥 반두께
const DOT_R = 105; // 중앙 셔터 점 반지름
const BG_TOP = [79, 70, 229]; // indigo
const BG_BOTTOM = [124, 58, 237]; // violet

function pixel(x, y) {
  // 배경 실루엣 (macOS 라운드 정사각형)
  const aBg = cov(sdRoundRect(x, y, SIZE / 2, SIZE / 2, 824, 824, 228));
  if (aBg <= 0) return [0, 0, 0, 0];

  // 세로 그라디언트 배경색
  const t = y / SIZE;
  let r = BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t;
  let g = BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t;
  let b = BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t;

  // 뷰파인더 브래킷 4개 (각 코너에서 중앙 방향으로 팔 2개)
  let d = Infinity;
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    const px = SIZE / 2 + sx * CORNER;
    const py = SIZE / 2 + sy * CORNER;
    d = Math.min(d, sdCapsule(x, y, px, py, px - sx * ARM, py, CAP_R));
    d = Math.min(d, sdCapsule(x, y, px, py, px, py - sy * ARM, CAP_R));
  }

  // 중앙 셔터 점
  d = Math.min(d, Math.hypot(x - SIZE / 2, y - SIZE / 2) - DOT_R);

  // 흰색 도형 합성
  const w = cov(d);
  r = r * (1 - w) + 255 * w;
  g = g * (1 - w) + 255 * w;
  b = b * (1 - w) + 255 * w;

  return [Math.round(r), Math.round(g), Math.round(b), Math.round(aBg * 255)];
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
