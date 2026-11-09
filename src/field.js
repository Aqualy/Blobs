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
  const pairs = [];
  const n = Math.min(blobs.length, LIMITS.maxBlobs);
  const snap = clamp(p.snap, 0.2, 0.97);
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
      const minR = Math.min(A.r, B.r);
      const reachDist = Math.max(p.reach * (A.r + B.r) * 0.5, 1e-3);
      if (gap >= reachDist) continue;
      // Nested circles: the bridge would be buried anyway.
      if (d + minR < Math.max(A.r, B.r) * 0.98) continue;

      const t = Math.max(gap, 0) / reachDist;
      const ux = dx / d;
      const uy = dy / d;

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

      pairs.push({
        ia: swap ? j : i, ib: swap ? i : j,
        x0, y0, x1, y1, w0, w1, wMid, neck, bend, k, taper,
        cx: (x0 + x1) * 0.5, cy: (y0 + y1) * 0.5, bound,
      });
      if (pairs.length >= LIMITS.maxPairs) return pairs;
    }
  }
  return pairs;
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
