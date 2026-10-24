window.addEventListener("error", (e) => console.error("overlay error:", e.message));

const dim = document.getElementById("dim");
const sel = document.getElementById("selection");
const sizeLabel = document.getElementById("size");

let start = null;
let dragging = false;

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function normalize(a, b) {
  const x1 = clamp(a.x, 0, window.innerWidth);
  const y1 = clamp(a.y, 0, window.innerHeight);
  const x2 = clamp(b.x, 0, window.innerWidth);
  const y2 = clamp(b.y, 0, window.innerHeight);
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

function update(x, y) {
  const r = normalize(start, { x, y });
  sel.style.left = `${r.x}px`;
  sel.style.top = `${r.y}px`;
  sel.style.width = `${r.width}px`;
  sel.style.height = `${r.height}px`;
  sizeLabel.textContent = `${r.width} × ${r.height}`;
}

document.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || dragging) return;
  dragging = true;
  start = { x: e.clientX, y: e.clientY };
  document.body.setPointerCapture(e.pointerId);
  window.myclip.started();
  dim.style.display = "none";
  sel.style.display = "block";
  update(e.clientX, e.clientY);
});

document.addEventListener("pointermove", (e) => {
  if (dragging) update(e.clientX, e.clientY);
});

document.addEventListener("pointerup", (e) => {
  if (!dragging) return;
  dragging = false;
  const r = normalize(start, { x: e.clientX, y: e.clientY });
  // 너무 작은 영역(클릉)은 캡처하지 않고 취소 처리
  if (r.width < 5 || r.height < 5) {
    window.myclip.cancel();
  } else {
    window.myclip.finish(r);
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") window.myclip.cancel();
});

document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  window.myclip.cancel();
});
