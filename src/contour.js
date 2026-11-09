// Marching squares contour extraction + smooth SVG path output.

/**
 * Extract closed iso-contours (value < 0 is inside) from a grid.
 * The grid must be padded with positive values on its border so every
 * contour closes.
 * @param {Float32Array} f values, row-major, nx * ny
 * @returns {number[][]} loops as flat [x0,y0,x1,y1,...] in grid coordinates
 */
export function marchingSquares(f, nx, ny) {
  // Edge point ids: horizontal edge (i,j)->(i+1,j): id = j*nx+i
  //                 vertical edge   (i,j)->(i,j+1): id = nx*ny + j*nx+i
  const H = 0, V = nx * ny;
  const px = new Map();
  const next = new Map(); // edge id -> linked edge id (directed)
  const point = (id) => {
    let p = px.get(id);
    if (p) return p;
    let i, j, a, b;
    if (id < V) { j = Math.floor(id / nx); i = id - j * nx; a = f[j * nx + i]; b = f[j * nx + i + 1];
      const t = a / (a - b); p = [i + t, j]; }
    else { const k = id - V; j = Math.floor(k / nx); i = k - j * nx; a = f[j * nx + i]; b = f[(j + 1) * nx + i];
      const t = a / (a - b); p = [i, j + t]; }
    px.set(id, p);
    return p;
  };
  const link = (a, b) => { next.set(a, b); };

  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const v0 = f[j * nx + i], v1 = f[j * nx + i + 1];
      const v2 = f[(j + 1) * nx + i + 1], v3 = f[(j + 1) * nx + i];
      let c = 0;
      if (v0 < 0) c |= 1;
      if (v1 < 0) c |= 2;
      if (v2 < 0) c |= 4;
      if (v3 < 0) c |= 8;
      if (c === 0 || c === 15) continue;
      const top = H + j * nx + i;
      const bottom = H + (j + 1) * nx + i;
      const left = V + j * nx + i;
      const right = V + j * nx + i + 1;
      // Directed so that inside is always on the same side.
      switch (c) {
        case 1: link(left, top); break;
        case 2: link(top, right); break;
        case 3: link(left, right); break;
        case 4: link(right, bottom); break;
        case 5: {
          const center = (v0 + v1 + v2 + v3) * 0.25;
          if (center < 0) { link(left, bottom); link(right, top); }
          else { link(left, top); link(right, bottom); }
          break;
        }
        case 6: link(top, bottom); break;
        case 7: link(left, bottom); break;
        case 8: link(bottom, left); break;
        case 9: link(bottom, top); break;
        case 10: {
          const center = (v0 + v1 + v2 + v3) * 0.25;
          if (center < 0) { link(top, left); link(bottom, right); }
          else { link(top, right); link(bottom, left); }
          break;
        }
        case 11: link(bottom, right); break;
        case 12: link(right, left); break;
        case 13: link(right, top); break;
        case 14: link(top, left); break;
      }
    }
  }

  const loops = [];
  const used = new Set();
  for (const start of next.keys()) {
    if (used.has(start)) continue;
    const loop = [];
    let cur = start;
    let guard = 0;
    while (cur !== undefined && !used.has(cur) && guard++ < 4e6) {
      used.add(cur);
      const p = point(cur);
      loop.push(p[0], p[1]);
      cur = next.get(cur);
    }
    if (loop.length >= 6) loops.push(loop);
  }
  return loops;
}

/** Ramer–Douglas–Peucker on a closed flat loop. */
export function simplifyLoop(pts, eps) {
  const n = pts.length / 2;
  if (n < 8) return pts;
  const keep = new Uint8Array(n);
  // Split the loop at its two most distant points.
  let far = 0, best = -1;
  for (let i = 1; i < n; i++) {
    const d = (pts[2 * i] - pts[0]) ** 2 + (pts[2 * i + 1] - pts[1]) ** 2;
    if (d > best) { best = d; far = i; }
  }
  keep[0] = keep[far] = 1;
  const stack = [[0, far], [far, n]];
  const e2 = eps * eps;
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = pts[2 * a], ay = pts[2 * a + 1];
    const bi = b % n;
    const bx = pts[2 * bi], by = pts[2 * bi + 1];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-12;
    let idx = -1, md = e2;
    for (let i = a + 1; i < b; i++) {
      const px = pts[2 * i] - ax, py = pts[2 * i + 1] - ay;
      const cr = px * dy - py * dx;
      const d = (cr * cr) / len2;
      if (d > md) { md = d; idx = i; }
    }
    if (idx >= 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[2 * i], pts[2 * i + 1]);
  return out;
}

const f2 = (v) => {
  const s = v.toFixed(2);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
};

/** Closed Catmull–Rom spline through the loop, as cubic Bézier SVG path data. */
export function loopToPath(pts, sx, sy, ox, oy) {
  const n = pts.length / 2;
  const X = (i) => pts[2 * (((i % n) + n) % n)] * sx + ox;
  const Y = (i) => pts[2 * (((i % n) + n) % n) + 1] * sy + oy;
  let d = `M${f2(X(0))} ${f2(Y(0))}`;
  for (let i = 0; i < n; i++) {
    const x0 = X(i - 1), y0 = Y(i - 1), x1 = X(i), y1 = Y(i);
    const x2 = X(i + 1), y2 = Y(i + 1), x3 = X(i + 2), y3 = Y(i + 2);
    const c1x = x1 + (x2 - x0) / 6, c1y = y1 + (y2 - y0) / 6;
    const c2x = x2 - (x3 - x1) / 6, c2y = y2 - (y3 - y1) / 6;
    d += `C${f2(c1x)} ${f2(c1y)} ${f2(c2x)} ${f2(c2y)} ${f2(x2)} ${f2(y2)}`;
  }
  return d + 'Z';
}
