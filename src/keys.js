// Keyframe animation, After Effects style.
//
// A blob can have two keyframe tracks:
//   keys.pos = [{ t, x, y, ease }]   its route (base position)
//   keys.r   = [{ t, v, ease }]      its radius (0 = not there yet / gone)
// t is in seconds on the document timeline (0 … doc.loop). A track with at
// least one key overrides the blob's static x/y or r; procedural motion
// (drift, orbit, swing, pulse) still plays on top of it.
//
// Temporal easing is per key, like AE's Easy Ease: a key with ease = true
// arrives and leaves with zero speed; a linear key keeps its speed. Spatial
// interpolation of the route is a centripetal Catmull–Rom spline through the
// position keys (keys.curve = false gives straight segments). Before the first
// key a track holds the first value, after the last it holds the last value.
// Every value is continuous in time.

export const TRACKS = ['pos', 'r'];
export const MAX_KEYS = 64;
/** Two keys closer than this (seconds) are the same key. */
export const KEY_EPS = 1 / 240;

export function emptyKeys() {
  return { pos: [], r: [], curve: true };
}

export const hasKeys = (b, track) => !!b.keys && b.keys[track].length > 0;
export const isKeyed = (b) => !!b.keys && (b.keys.pos.length > 1 || b.keys.r.length > 1);

/** Index of the segment [i, i+1] that contains t, or -1 / n-1 outside. */
function segment(keys, t) {
  let lo = 0, hi = keys.length - 1;
  if (t < keys[0].t) return -1;
  if (t >= keys[hi].t) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid].t <= t) lo = mid; else hi = mid;
  }
  return lo;
}

/**
 * Eased progress through a segment: cubic Hermite with unit end speed for a
 * linear key and zero end speed for an eased one. Linear–linear is identity,
 * ease–ease is smoothstep.
 */
export function easeSeg(u, easeOut, easeIn) {
  const a = easeOut ? 0 : 1, b = easeIn ? 0 : 1;
  const u2 = u * u, u3 = u2 * u;
  return (-2 * u3 + 3 * u2) + a * (u3 - 2 * u2 + u) + b * (u3 - u2);
}

function progress(keys, i, t) {
  const k0 = keys[i], k1 = keys[i + 1];
  const span = k1.t - k0.t;
  const u = span > 1e-9 ? (t - k0.t) / span : 1;
  return easeSeg(u < 0 ? 0 : u > 1 ? 1 : u, k0.ease, k1.ease);
}

/** Radius (or any scalar track) at time t. */
export function sampleScalar(keys, t) {
  const i = segment(keys, t);
  if (i < 0) return keys[0].v;
  if (i >= keys.length - 1) return keys[keys.length - 1].v;
  const s = progress(keys, i, t);
  return keys[i].v + (keys[i + 1].v - keys[i].v) * s;
}

/** Centripetal Catmull–Rom point between p1 and p2 (Barry–Goldman form). */
function catmull(p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y, s, out) {
  const kn = (ax, ay, bx, by) => Math.max(Math.sqrt(Math.hypot(bx - ax, by - ay)), 1e-4);
  const t0 = 0;
  const t1 = t0 + kn(p0x, p0y, p1x, p1y);
  const t2 = t1 + kn(p1x, p1y, p2x, p2y);
  const t3 = t2 + kn(p2x, p2y, p3x, p3y);
  const t = t1 + (t2 - t1) * s;
  const L = (ax, bx, ta, tb) => ((tb - t) * ax + (t - ta) * bx) / (tb - ta);
  const a1x = L(p0x, p1x, t0, t1), a1y = L(p0y, p1y, t0, t1);
  const a2x = L(p1x, p2x, t1, t2), a2y = L(p1y, p2y, t1, t2);
  const a3x = L(p2x, p3x, t2, t3), a3y = L(p2y, p3y, t2, t3);
  const b1x = L(a1x, a2x, t0, t2), b1y = L(a1y, a2y, t0, t2);
  const b2x = L(a2x, a3x, t1, t3), b2y = L(a2y, a3y, t1, t3);
  out.x = L(b1x, b2x, t1, t2);
  out.y = L(b1y, b2y, t1, t2);
  return out;
}

/** Route point of segment i at spatial parameter s ∈ [0, 1]. */
export function routePoint(keys, i, s, curve, out) {
  const k1 = keys[i], k2 = keys[i + 1];
  if (!curve || keys.length < 3 || (k1.x === k2.x && k1.y === k2.y)) {
    out.x = k1.x + (k2.x - k1.x) * s;
    out.y = k1.y + (k2.y - k1.y) * s;
    return out;
  }
  // Missing neighbours are mirrored, which makes the end tangents natural.
  const k0 = keys[i - 1], k3 = keys[i + 2];
  const p0x = k0 ? k0.x : 2 * k1.x - k2.x, p0y = k0 ? k0.y : 2 * k1.y - k2.y;
  const p3x = k3 ? k3.x : 2 * k2.x - k1.x, p3y = k3 ? k3.y : 2 * k2.y - k1.y;
  return catmull(p0x, p0y, k1.x, k1.y, k2.x, k2.y, p3x, p3y, s, out);
}

/** Base position at time t. */
export function samplePos(keys, t, curve, out) {
  const i = segment(keys, t);
  if (i < 0) { out.x = keys[0].x; out.y = keys[0].y; return out; }
  if (i >= keys.length - 1) { const k = keys[keys.length - 1]; out.x = k.x; out.y = k.y; return out; }
  return routePoint(keys, i, progress(keys, i, t), curve, out);
}

/** Static or keyframed base values of a blob at time t (before procedural motion). */
export function baseAt(b, t, out) {
  const k = b.keys;
  if (k && k.pos.length) samplePos(k.pos, t, k.curve !== false, out);
  else { out.x = b.x; out.y = b.y; }
  out.r = k && k.r.length ? sampleScalar(k.r, t) : b.r;
  return out;
}

/** The key of a track at time t (within KEY_EPS), or null. */
export function keyAt(track, t) {
  for (const k of track) if (Math.abs(k.t - t) <= KEY_EPS) return k;
  return null;
}

/** Insert or update the key at time t. Returns the key. */
export function setKey(track, t, values, ease = true) {
  let k = keyAt(track, t);
  if (k) { Object.assign(k, values); return k; }
  if (track.length >= MAX_KEYS) return null;
  k = { t, ...values, ease };
  track.push(k);
  sortTrack(track);
  return k;
}

export function sortTrack(track) {
  track.sort((a, b) => a.t - b.t);
}

/**
 * Sanitize keys from any source. Keys are sorted, de-duplicated, clamped and
 * capped; anything malformed is dropped.
 */
export function normalizeKeys(raw, limits) {
  const out = emptyKeys();
  if (!raw || typeof raw !== 'object') return out;
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const clean = (list, make) => {
    if (!Array.isArray(list)) return [];
    const keys = [];
    for (const k of list.slice(0, MAX_KEYS * 2)) {
      if (!k || typeof k !== 'object' || num(k.t) == null) continue;
      const v = make(k);
      if (!v) continue;
      keys.push({ t: clamp(num(k.t), 0, limits.maxTime), ...v, ease: k.ease !== false });
    }
    sortTrack(keys);
    const dedup = [];
    for (const k of keys) {
      const last = dedup[dedup.length - 1];
      if (last && k.t - last.t <= KEY_EPS) dedup[dedup.length - 1] = k; else dedup.push(k);
    }
    return dedup.slice(0, MAX_KEYS);
  };
  out.pos = clean(raw.pos, (k) => {
    const x = num(k.x), y = num(k.y);
    if (x == null || y == null) return null;
    return { x: clamp(x, limits.minX, limits.maxX), y: clamp(y, limits.minY, limits.maxY) };
  });
  out.r = clean(raw.r, (k) => {
    const v = num(k.v);
    return v == null ? null : { v: clamp(v, 0, 2000) };
  });
  out.curve = raw.curve !== false;
  return out;
}
