// ------------
// Crop geometry (screenshot import)
// ------------
// Pure and module level so the drag maths can be tested without a browser.
// All rects are normalized 0..1 against the displayed image.

// Keep a rect the right way round and inside the image. Dragging a corner past
// its opposite side is normal behaviour, not an error, so a negative width is
// flipped rather than rejected.
export function cropNormalize(r) {
  var x = r.w < 0 ? r.x + r.w : r.x;
  var y = r.h < 0 ? r.y + r.h : r.y;
  var w = Math.abs(r.w), h = Math.abs(r.h);
  if (x < 0) { w += x; x = 0; }
  if (y < 0) { h += y; y = 0; }
  if (x + w > 1) w = 1 - x;
  if (y + h > 1) h = 1 - y;
  return { x: x, y: y, w: Math.max(0, w), h: Math.max(0, h) };
}

// What a press at (nx, ny) should do. Corners and edges win over the interior
// so a finger landing near an edge resizes rather than dragging the whole box.
// tol is in normalized units, sized by the caller from a real touch target.
export function cropHit(nx, ny, r, tolX, tolY) {
  var nearL = Math.abs(nx - r.x) <= tolX;
  var nearR = Math.abs(nx - (r.x + r.w)) <= tolX;
  var nearT = Math.abs(ny - r.y) <= tolY;
  var nearB = Math.abs(ny - (r.y + r.h)) <= tolY;
  var inX = nx >= r.x - tolX && nx <= r.x + r.w + tolX;
  var inY = ny >= r.y - tolY && ny <= r.y + r.h + tolY;
  if (nearL && nearT) return "nw";
  if (nearR && nearT) return "ne";
  if (nearL && nearB) return "sw";
  if (nearR && nearB) return "se";
  if (nearL && inY) return "w";
  if (nearR && inY) return "e";
  if (nearT && inX) return "n";
  if (nearB && inX) return "s";
  if (nx > r.x && nx < r.x + r.w && ny > r.y && ny < r.y + r.h) return "move";
  return "draw";
}

// Apply a drag of (dx, dy) to the rect the press started on.
export function cropApply(mode, r0, dx, dy) {
  if (mode === "move") {
    var mx = Math.min(1 - r0.w, Math.max(0, r0.x + dx));
    var my = Math.min(1 - r0.h, Math.max(0, r0.y + dy));
    return { x: mx, y: my, w: r0.w, h: r0.h };
  }
  var x = r0.x, y = r0.y, w = r0.w, h = r0.h;
  if (mode.indexOf("w") !== -1) { x = r0.x + dx; w = r0.w - dx; }
  if (mode.indexOf("e") !== -1) { w = r0.w + dx; }
  if (mode.indexOf("n") !== -1) { y = r0.y + dy; h = r0.h - dy; }
  if (mode.indexOf("s") !== -1) { h = r0.h + dy; }
  return cropNormalize({ x: x, y: y, w: w, h: h });
}
