// Resolves a document at a point in time into render-ready blobs + bridges.
import { computePairs, LIMITS } from './field.js';
import { resolveBlob } from './model.js';
import { hexToRgb } from './renderer.js';

const rgbCache = new Map();
function rgbOf(hex) {
  let v = rgbCache.get(hex);
  if (!v) { v = hexToRgb(hex); rgbCache.set(hex, v); }
  return v;
}

/**
 * Below VANISH_R a blob with keyframed size sinks out of sight: its drawn radius goes from
 * VANISH_R down to -VANISH_DEPTH at r = 0, continuously, so a blob keyframed
 * to size 0 leaves no anti-aliased dot behind and simply is not there.
 */
export const VANISH_R = 2;
export const VANISH_DEPTH = 8;
export const drawnRadius = (r) => (r >= VANISH_R ? r : r - VANISH_DEPTH * (1 - Math.max(r, 0) / VANISH_R));

/**
 * @returns {{ blobs: object[], pairs: object[], all: object[] }}
 *   blobs: what is drawn (blobs of size 0 left out, tiny ones sunk),
 *   pairs: their bridges,
 *   all:   every blob resolved at its true size, in document order (for editing).
 */
export function frameAt(doc, time) {
  const blobs = [];
  const all = [];
  const n = Math.min(doc.blobs.length, LIMITS.maxBlobs);
  for (let i = 0; i < n; i++) {
    const src = doc.blobs[i];
    const b = resolveBlob(src, time, doc.loop, {});
    b.rgb = rgbOf(src.color);
    b.color = src.color;
    // Keyframed size can reach 0: its bridges fade instead of switching (field.js GROW_R).
    if (src.keys && src.keys.r.length) b.grow = true;
    all.push(b);
    if (b.r <= 0) continue;
    blobs.push(!b.grow || b.r >= VANISH_R ? b : { ...b, r: drawnRadius(b.r) });
  }
  return { blobs, pairs: computePairs(blobs, doc.params), all };
}
