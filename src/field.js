// Core blob field, shared by the WebGL renderer (via packed pair data),
// the CPU evaluator (SVG export) and the tests.
//
// Every blob is a circle. Every pair of blobs within "reach" gets a bridge:
// a tapered, slightly bent capsule between the two circle surfaces whose
// thickness is a smooth function of the gap. Circles and bridges are merged
// with a cubic smooth-min, which produces the concave fillets.
//
// As two blobs move apart the neck thins to a hairline, pinches, and the two
// halves retract into their blobs before the pair leaves reach. Every
// quantity is continuous in blob position and size, so nothing ever pops.

export const DEFAULT_PARAMS = Object.freeze({
  reach: 3.8,      // max gap before a bridge is gone, × average radius
  thickness: 0.4,  // neck half-width when blobs touch, × smaller radius
  flare: 0.36,     // bridge width where it enters a blob, × that blob's radius
  smooth: 0.5,     // fillet size, × smaller radius
  snap: 0.86,      // fraction of reach at which the neck pinches off
  taper: 3.0,      // profile exponent: higher = thin for longer, sharper flare
  organic: 0.55,   // per-bridge bend and neck asymmetry
  noOverlap: false, // bridges give way instead of crossing or merging into each other
});

export const PARAM_RANGES = Object.freeze({
  reach: [0.5, 8, 0.05],
  thickness: [0.05, 1, 0.01],
  flare: [0.1, 0.7, 0.01],
  smooth: [0.05, 1.2, 0.01],
  snap: [0.3, 0.95, 0.01],
  taper: [1.2, 6, 0.05],
  organic: [0, 1, 0.01],
});

export const LIMITS = Object.freeze({ maxBlobs: 128, maxPairs: 512 });

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Stable pseudo-random in [-1, 1] from two integer ids and a channel.
export function hash3(a, b, c) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

/** Fillet size used when merging a blob into the union. */
export const blobK = (r, p) => Math.max(p.smooth * r * 0.5, 1e-3);

/**
 * Build the list of active bridges.
 * @param {{x:number,y:number,r:number,id:number}[]} blobs resolved (animated) blobs
 * @param {typeof DEFAULT_PARAMS} p
 */
export function computePairs(blobs, p) {
  const cands = [];
  const n = Math.min(blobs.length, LIMITS.maxBlobs);
  for (let i = 0; i < n; i++) {
    const A0 = blobs[i];
    for (let j = i + 1; j < n; j++) {
      const B0 = blobs[j];
      // Order by id so a bridge's random traits never depend on list order.
      const swap = A0.id > B0.id;
      const A = swap ? B0 : A0;
      const B = swap ? A0 : B0;

      const dx = B.x - A.x;
      const dy = B.y - A.y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-3 || A.r <= 0.5 || B.r <= 0.5) continue;
      const gap = d - A.r - B.r;
      const reachDist = Math.max(p.reach * (A.r + B.r) * 0.5, 1e-3);
      if (gap >= reachDist) continue;
      // Nested circles: the bridge would be buried anyway.
      if (d + Math.min(A.r, B.r) < Math.max(A.r, B.r) * 0.98) continue;

      cands.push({
        A, B, ia: swap ? j : i, ib: swap ? i : j, d, gap,
        ux: dx / d, uy: dy / d,
        t: Math.max(gap, 0) / reachDist,
        sup: 0,
      });
    }
  }

  if (p.noOverlap && cands.length) suppressOverlaps(cands, blobs, n, p);

  const pairs = [];
  for (const c of cands) {
    const t = c.sup > 0 ? suppressedT(c.t, c.sup, p.snap) : c.t;
    if (t >= 1) continue;
    pairs.push(buildPair(c, t, p));
    if (pairs.length >= LIMITS.maxPairs) break;
  }
  return pairs;
}

/**
 * Suppression pushes a bridge along its own path: first it thins while
 * staying connected (so a composition that settles mid-way shows a thin
 * bridge, not thorns), and only in the last stretch pinches and retracts.
 */
function suppressedT(t, sup, snap) {
  const thin = Math.max(t, clamp(snap, 0.2, 0.97) * 0.97);
  const t1 = t + (thin - t) * smoothstep(0, 0.45, sup);
  return t1 + (1 - t1) * smoothstep(0.35, 1, sup);
}

/** Bridge geometry for a candidate at normalized gap t (0 = touching, 1 = gone). */
function buildPair(c, t, p) {
  const { A, B, d, gap, ux, uy } = c;
  const snap = clamp(p.snap, 0.2, 0.97);
  const minR = Math.min(A.r, B.r);
  const pinch = smoothstep(snap, 1, t); // 0 until the neck snaps, 1 at reach
  const life = 1 - pinch;

  // Neck half-width: thick when touching, hairline at the snap point,
  // negative afterwards (the bridge is split in the middle).
  const wMid = t < snap
    ? minR * p.thickness * Math.pow(1 - t / snap, 2)
    : -minR * 0.3 * pinch;
  // Past the snap the remains are pushed strictly outside the surface,
  // so a bridge leaving reach has zero visible contribution.
  const kill = Math.max(minR * 0.06, 2.5) * pinch;
  const w0 = A.r * p.flare * life - kill;
  const w1 = B.r * p.flare * life - kill;

  // Segment endpoints, inset into each circle so the flare grows out of it.
  let s0, s1;
  if (gap >= 0) { s0 = A.r; s1 = d - B.r; }
  else { s0 = s1 = (A.r + d - B.r) * 0.5; }
  s0 -= A.r * 0.32;
  s1 += B.r * 0.32;
  const x0 = A.x + ux * s0, y0 = A.y + uy * s0;
  const x1 = A.x + ux * s1, y1 = A.y + uy * s1;

  const bend = p.organic * 0.16 * hash3(A.id, B.id, 1);
  const neck = 0.5 + p.organic * 0.16 * hash3(A.id, B.id, 2);
  const k = Math.max(p.smooth * minR * (0.35 + 0.65 * life), 1e-3) * (1 - pinch * 0.999);

  const L = s1 - s0;
  const bound = L * 0.5 + Math.abs(bend) * L + Math.max(w0, w1, wMid, 0) + 1;

  // Approaching the snap, the profile turns from a long thread into a
  // localized pinch, so a breaking bridge never lingers as a hairline.
  const taper = p.taper + (Math.min(p.taper, 1.6) - p.taper) * smoothstep(snap * 0.5, snap, t);

  const Ls = Math.max(L, 1e-4);
  return {
    ia: c.ia, ib: c.ib,
    x0, y0, x1, y1, w0, w1, wMid, neck, bend, k, taper,
    cx: (x0 + x1) * 0.5, cy: (y0 + y1) * 0.5, bound,
    // Span of the segment that lies outside both blobs (for clearance tests).
    ta: Math.min((A.r * 0.32) / Ls, 0.5),
    tb: Math.max(1 - (B.r * 0.32) / Ls, 0.5),
  };
}

/** Bridge half-width at parameter tx along its segment. */
function profileAt(br, tx) {
  const m = br.neck;
  const u = tx < m ? (m - tx) / m : (tx - m) / (1 - m);
  const wEnd = tx < m ? br.w0 : br.w1;
  return br.wMid + (wEnd - br.wMid) * Math.pow(u, br.taper);
}

const SAMPLES = 9;

/** Centre-line samples [x, y, halfWidth] of the visible part of a bridge. */
function sampleBridge(br) {
  const out = new Float64Array(SAMPLES * 3);
  const bx = br.x1 - br.x0, by = br.y1 - br.y0;
  const L = Math.max(Math.hypot(bx, by), 1e-4);
  const ux = bx / L, uy = by / L;
  for (let s = 0; s < SAMPLES; s++) {
    const tx = br.ta + (br.tb - br.ta) * (s / (SAMPLES - 1));
    const off = br.bend * L * 4 * tx * (1 - tx);
    out[s * 3] = br.x0 + ux * tx * L - uy * off;
    out[s * 3 + 1] = br.y0 + uy * tx * L + ux * off;
    out[s * 3 + 2] = Math.max(profileAt(br, tx), 0);
  }
  return out;
}

/**
 * Extra clearance granted near blobs the bridges legitimately meet at:
 * bridges always join their own blobs, so closeness there is not an overlap.
 * Each root is { X, zone, w }; the allowance fades out gently (over twice
 * the zone) so nothing changes abruptly as a bridge leaves a root's area.
 */
function rootAllowance(x, y, roots) {
  let best = 0;
  for (const r of roots) {
    const e = Math.hypot(x - r.X.x, y - r.X.y) - r.X.r;
    const v = r.w * (r.zone * 2.5 + 10) * (1 - smoothstep(0, r.zone * 2, e));
    if (v > best) best = v;
  }
  return best;
}

/** 1 for the same blob or blobs merged together, fading to 0 as they part. */
function touching(E1, E2, p) {
  if (E1 === E2) return 1;
  const gap = Math.hypot(E1.x - E2.x, E1.y - E2.y) - E1.r - E2.r;
  return 1 - smoothstep(0, blobK(Math.min(E1.r, E2.r), p) + 4, gap);
}

// Closest points between segments AB and CD. Writes [distance, s, t] into SEG.
const SEG = [0, 0, 0];
function segSeg(ax, ay, bx, by, cx, cy, dx, dy) {
  const ux = bx - ax, uy = by - ay, vx = dx - cx, vy = dy - cy, wx = ax - cx, wy = ay - cy;
  const A = ux * ux + uy * uy, B = ux * vx + uy * vy, C = vx * vx + vy * vy;
  const D = ux * wx + uy * wy, E = vx * wx + vy * wy;
  const den = A * C - B * B;
  let sN, sD = den, tN, tD = den;
  if (den < 1e-9) { sN = 0; sD = 1; tN = E; tD = C; }
  else {
    sN = B * E - C * D; tN = A * E - B * D;
    if (sN < 0) { sN = 0; tN = E; tD = C; } else if (sN > sD) { sN = sD; tN = E + B; tD = C; }
  }
  if (tN < 0) { tN = 0; if (-D < 0) sN = 0; else if (-D > A) sN = sD; else { sN = -D; sD = A; } }
  else if (tN > tD) { tN = tD; if (-D + B < 0) sN = 0; else if (-D + B > A) sN = sD; else { sN = -D + B; sD = A; } }
  const sc = Math.abs(sN) < 1e-12 ? 0 : sN / (sD || 1e-12);
  const tc = Math.abs(tN) < 1e-12 ? 0 : tN / (tD || 1e-12);
  SEG[0] = Math.hypot(wx + sc * ux - tc * vx, wy + sc * uy - tc * vy);
  SEG[1] = sc; SEG[2] = tc;
  return SEG;
}

/**
 * Smallest gap between the surfaces of two sampled bridges (negative when
 * they interpenetrate), ignoring closeness around a shared root blob.
 */
let CLR_W = 0; // combined half-widths at the closest approach of the last call
function bridgeClearance(P, Q, roots) {
  let best = Infinity;
  CLR_W = 0;
  for (let i = 0; i < SAMPLES - 1; i++) {
    const ax = P[i * 3], ay = P[i * 3 + 1], bx = P[i * 3 + 3], by = P[i * 3 + 4];
    for (let j = 0; j < SAMPLES - 1; j++) {
      const cx = Q[j * 3], cy = Q[j * 3 + 1], dx = Q[j * 3 + 3], dy = Q[j * 3 + 4];
      const [dist, sc, tc] = segSeg(ax, ay, bx, by, cx, cy, dx, dy);
      const pr = P[i * 3 + 2] + (P[i * 3 + 5] - P[i * 3 + 2]) * sc;
      const qr = Q[j * 3 + 2] + (Q[j * 3 + 5] - Q[j * 3 + 2]) * tc;
      let c = dist - pr - qr;
      if (roots.length) {
        const px = ax + (bx - ax) * sc, py = ay + (by - ay) * sc;
        const qx = cx + (dx - cx) * tc, qy = cy + (dy - cy) * tc;
        c += Math.min(rootAllowance(px, py, roots), rootAllowance(qx, qy, roots));
      }
      if (c < best) { best = c; CLR_W = pr + qr; }
    }
  }
  return best;
}

/**
 * No-overlap mode. Gives every candidate a suppression amount in [0, 1]
 * when its bridge would touch another bridge or run into a third blob.
 * Every term is a smooth function of positions, so bridges give way
 * gracefully instead of popping. Between two bridges, the weaker one
 * (the relatively longer gap) yields.
 */
function suppressOverlaps(cands, blobs, n, p) {
  // Every candidate takes part (merged pairs included) so nothing switches abruptly.
  const live = cands;
  const m = live.length;
  if (!m) return;
  const geo = live.map((c) => {
    const br = buildPair(c, c.t, p);
    return { br, smp: sampleBridge(br), strength: 1 - c.t };
  });
  // Only real contact counts: the ramp starts just before surfaces would
  // visibly web together through the smooth-min fillet.
  const ramp = (clearance, margin) => 1 - smoothstep(margin, margin * 1.6 + 6, clearance);
  const rootZone = (br, X) => Math.max(br.w0, br.w1, 0) * 1.5 + br.k * 0.5 + X.r * 0.1;

  // Bridge vs third blob: the bridge always yields.
  const blobSup = new Float64Array(m);
  for (let a = 0; a < m; a++) {
    const c = live[a], { br, smp } = geo[a];
    let keep = 1;
    for (let i = 0; i < n; i++) {
      const C = blobs[i];
      if (C === c.A || C === c.B) continue;
      if (Math.hypot(C.x - br.cx, C.y - br.cy) > br.bound + C.r + br.k * 2 + 8) continue;
      // A blob merged with one of the bridge's own blobs is part of its root.
      const wC = 1 - Math.max(touching(C, c.A, p), touching(C, c.B, p));
      if (wC <= 0) continue;
      let best = Infinity;
      const roots = [{ X: c.A, zone: rootZone(br, c.A), w: 1 }, { X: c.B, zone: rootZone(br, c.B), w: 1 }];
      for (let s = 0; s < SAMPLES; s++) {
        const x = smp[s * 3], y = smp[s * 3 + 1];
        const g = Math.hypot(x - C.x, y - C.y) - C.r - smp[s * 3 + 2] + rootAllowance(x, y, roots);
        if (g < best) best = g;
      }
      keep *= 1 - wC * ramp(best, Math.max(br.k, blobK(C.r, p)) * 0.3 + 2);
    }
    blobSup[a] = 1 - keep;
  }

  // Bridge vs bridge.
  const over = new Float64Array(m * m);  // overlap amount, symmetric
  const prio = new Float64Array(m * m);  // how much [a] yields to [b]
  const cross = new Float64Array(m * m); // 0 = brushing side by side, 1 = passing through each other
  for (let a = 0; a < m; a++) {
    for (let b = a + 1; b < m; b++) {
      const P = geo[a], Q = geo[b];
      const far = P.br.bound + Q.br.bound + Math.max(P.br.k, Q.br.k) * 2 + 8;
      if (Math.hypot(P.br.cx - Q.br.cx, P.br.cy - Q.br.cy) > far) continue;
      const ca = live[a], cb = live[b];
      // Shared blobs, and ends on blobs merged with each other, are roots
      // where the two bridges may meet.
      const roots = [];
      for (const E1 of [ca.A, ca.B]) for (const E2 of [cb.A, cb.B]) {
        const w = touching(E1, E2, p);
        if (w <= 0) continue;
        for (const X of E1 === E2 ? [E1] : [E1, E2]) {
          roots.push({ X, zone: Math.max(rootZone(P.br, X), rootZone(Q.br, X)), w });
        }
      }
      const clearance = bridgeClearance(P.smp, Q.smp, roots);
      const o = ramp(clearance, Math.max(P.br.k, Q.br.k) * 0.3 + 2);
      if (o <= 0) continue;
      over[a * m + b] = over[b * m + a] = o;
      // How deeply the two interpenetrate. A real crossing removes both
      // bridges unless one is clearly stronger; brushing only moves the weaker.
      // At a true crossing the clearance is exactly -(both half-widths).
      const cr = smoothstep(0.3, 0.9, -clearance / Math.max(CLR_W, 1));
      cross[a * m + b] = cross[b * m + a] = cr;
      const win = 0.15 + 0.3 * cr;
      const y = smoothstep(-win, win, Q.strength - P.strength);
      prio[a * m + b] = y;
      prio[b * m + a] = 1 - y;
    }
  }

  // Relaxation passes: a bridge that is itself giving way pushes others less.
  let sup = Float64Array.from(blobSup);
  for (let pass = 0; pass < 3; pass++) {
    const next = new Float64Array(m);
    for (let a = 0; a < m; a++) {
      let keep = 1 - blobSup[a];
      for (let b = 0; b < m; b++) {
        const o = over[a * m + b];
        if (!o) continue;
        // A bridge that is itself giving way pushes others less, except at a
        // crossing, where both are meant to go.
        const att = 1 - sup[b] * (1 - cross[a * m + b]);
        keep *= 1 - Math.min(1, o * prio[a * m + b] * (2 + 2 * cross[a * m + b])) * att;
      }
      next[a] = 1 - keep;
    }
    sup = next;
  }
  for (let a = 0; a < m; a++) live[a].sup = sup[a];
}

/** Signed distance estimate from (px,py) to a bridge. Writes t-along into out[1]. */
export function bridgeDist(px, py, br, out) {
  const bx = br.x1 - br.x0;
  const by = br.y1 - br.y0;
  const L = Math.max(Math.hypot(bx, by), 1e-4);
  const ux = bx / L, uy = by / L;
  const rx = px - br.x0, ry = py - br.y0;
  const x = rx * ux + ry * uy;
  let y = -rx * uy + ry * ux;
  const tx = clamp(x / L, 0, 1);
  y -= br.bend * L * 4 * tx * (1 - tx);
  const m = br.neck;
  let u, wEnd;
  if (tx < m) { u = (m - tx) / m; wEnd = br.w0; }
  else { u = (tx - m) / (1 - m); wEnd = br.w1; }
  const r = br.wMid + (wEnd - br.wMid) * Math.pow(u, br.taper);
  const q = Math.hypot(x - tx * L, y);
  if (out) out[1] = tx;
  return q - r;
}

// Colours change over a narrower band than the shape fillet, so junctions
// between differently coloured blobs stay clean instead of muddy.
export const COLOR_BAND = 0.3;

/** Where along a bridge the colour switches from blob A to blob B. */
export const bridgeColorT = (tx, neck) => smoothstep(neck - 0.2, neck + 0.2, tx);

// Cubic smooth-min: returns min, writes blend-toward-b into s.w
const S = { w: 0 };
function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  S.w = clamp(0.5 + 0.5 * (a - b) / (k * COLOR_BAND), 0, 1);
  return Math.min(a, b) - h * h * h * k * (1 / 6);
}

const tmp = [0, 0];

/** Signed distance estimate of the whole composition (negative = inside). */
export function evalField(px, py, blobs, pairs, p) {
  let d = 1e9;
  for (let i = 0; i < blobs.length; i++) {
    const b = blobs[i];
    const k = blobK(b.r, p);
    const di = Math.hypot(px - b.x, py - b.y) - b.r;
    if (di > d + k) continue;
    d = smin(d, di, k);
  }
  for (let i = 0; i < pairs.length; i++) {
    const br = pairs[i];
    if (Math.hypot(px - br.cx, py - br.cy) - br.bound > d + br.k) continue;
    d = smin(d, bridgeDist(px, py, br, null), br.k);
  }
  return d;
}

/**
 * Field plus per-colour ownership weights (used for multi-colour SVG).
 * @param {Int32Array|number[]} colorIndex colour slot of each blob
 * @param {Float32Array} w output weights, length = number of colour slots
 */
export function evalFieldWeights(px, py, blobs, pairs, p, colorIndex, w) {
  const nc = w.length;
  w.fill(0);
  let d = 1e9;
  let first = true;
  for (let i = 0; i < blobs.length; i++) {
    const b = blobs[i];
    const k = blobK(b.r, p);
    const di = Math.hypot(px - b.x, py - b.y) - b.r;
    if (!first && di > d + k) continue;
    d = smin(d, di, k);
    const s = first ? 1 : S.w;
    first = false;
    for (let c = 0; c < nc; c++) w[c] *= 1 - s;
    w[colorIndex[i]] += s;
  }
  for (let i = 0; i < pairs.length; i++) {
    const br = pairs[i];
    if (Math.hypot(px - br.cx, py - br.cy) - br.bound > d + br.k) continue;
    const bd = bridgeDist(px, py, br, tmp);
    d = smin(d, bd, br.k);
    const s = S.w;
    if (s <= 0) continue;
    const tx = bridgeColorT(tmp[1], br.neck);
    for (let c = 0; c < nc; c++) w[c] *= 1 - s;
    w[colorIndex[br.ia]] += s * (1 - tx);
    w[colorIndex[br.ib]] += s * tx;
  }
  return d;
}
