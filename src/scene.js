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

export function frameAt(doc, time) {
  const blobs = [];
  const n = Math.min(doc.blobs.length, LIMITS.maxBlobs);
  for (let i = 0; i < n; i++) {
    const src = doc.blobs[i];
    const b = resolveBlob(src, time, doc.loop, {});
    b.rgb = rgbOf(src.color);
    b.color = src.color;
    blobs.push(b);
  }
  return { blobs, pairs: computePairs(blobs, doc.params) };
}
