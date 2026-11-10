// Animated GIF encoder: one global palette (median cut), no dithering (dither
// noise would shimmer between frames), optional 1-bit transparency.
import { Writer } from './bytes.js';

/** Alpha at or above this is opaque in a transparent GIF. */
const ALPHA_CUT = 128;

/**
 * Build a palette from sample frames.
 * @param {Uint8Array[]} samples RGBA frames
 * @param {number} maxColors
 * @returns {{ palette: Uint8Array, lut: Uint8Array }} palette RGB triples and
 *   a 15-bit (5:5:5) colour → index lookup table
 */
export function buildPalette(samples, maxColors, transparent) {
  const N = 32768;
  const count = new Float64Array(N);
  const sr = new Float64Array(N), sg = new Float64Array(N), sb = new Float64Array(N);
  for (const px of samples) {
    for (let i = 0; i < px.length; i += 4) {
      if (transparent && px[i + 3] < ALPHA_CUT) continue;
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      count[k]++; sr[k] += r; sg[k] += g; sb[k] += b;
    }
  }
  const bins = [];
  for (let k = 0; k < N; k++) if (count[k]) bins.push(k);
  if (!bins.length) bins.push(0), (count[0] = 1);

  // Median cut on the occupied bins (bins carry their mean colour).
  const mean = (k, c) => (c === 0 ? sr : c === 1 ? sg : sb)[k] / count[k];
  const makeBox = (list) => {
    let lo = [255, 255, 255], hi = [0, 0, 0], n = 0;
    for (const k of list) {
      n += count[k];
      for (let c = 0; c < 3; c++) {
        const v = mean(k, c);
        if (v < lo[c]) lo[c] = v;
        if (v > hi[c]) hi[c] = v;
      }
    }
    const ranges = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
    const axis = ranges.indexOf(Math.max(...ranges));
    return { list, n, axis, range: ranges[axis] };
  };
  const boxes = [makeBox(bins)];
  while (boxes.length < maxColors) {
    let bi = -1, best = 0;
    boxes.forEach((b, i) => {
      if (b.list.length < 2) return;
      // Weighted by population so large areas get their exact colours.
      const score = b.range * Math.sqrt(b.n);
      if (score > best) { best = score; bi = i; }
    });
    if (bi < 0) break;
    const box = boxes[bi];
    const sorted = box.list.slice().sort((x, y) => mean(x, box.axis) - mean(y, box.axis));
    let acc = 0, cut = 1;
    for (let i = 0; i < sorted.length - 1; i++) {
      acc += count[sorted[i]];
      if (acc >= box.n / 2) { cut = i + 1; break; }
      cut = i + 1;
    }
    boxes.splice(bi, 1, makeBox(sorted.slice(0, cut)), makeBox(sorted.slice(cut)));
  }

  const palette = new Uint8Array(boxes.length * 3);
  boxes.forEach((b, i) => {
    let r = 0, g = 0, bl = 0, n = 0;
    for (const k of b.list) { r += sr[k]; g += sg[k]; bl += sb[k]; n += count[k]; }
    palette[i * 3] = Math.round(r / n);
    palette[i * 3 + 1] = Math.round(g / n);
    palette[i * 3 + 2] = Math.round(bl / n);
  });

  // Lookup: each 5:5:5 bin maps to the palette entry nearest its mean colour
  // (or its centre if no sample landed in it).
  const lut = new Uint8Array(N);
  const P = boxes.length;
  for (let k = 0; k < N; k++) {
    let r, g, b;
    if (count[k]) { r = sr[k] / count[k]; g = sg[k] / count[k]; b = sb[k] / count[k]; }
    else { r = ((k >> 10) << 3) + 4; g = (((k >> 5) & 31) << 3) + 4; b = ((k & 31) << 3) + 4; }
    let bi = 0, bd = Infinity;
    for (let i = 0; i < P; i++) {
      const dr = r - palette[i * 3], dg = g - palette[i * 3 + 1], db = b - palette[i * 3 + 2];
      const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
      if (d < bd) { bd = d; bi = i; }
    }
    lut[k] = bi;
  }
  return { palette, lut };
}

/** GIF LZW compression of 8-bit indices, packed into 255-byte sub-blocks. */
export function lzwEncode(indices, minCodeSize = 8) {
  const out = new Writer(indices.length >> 1);
  const clear = 1 << minCodeSize, eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let next = eoi + 1;
  // Dictionary keyed by prefix code * 256 + byte.
  let dict = new Map();
  let bitBuf = 0, bitCount = 0;
  const block = new Uint8Array(255);
  let blen = 0;
  const flushByte = (b) => {
    block[blen++] = b;
    if (blen === 255) { out.u8(255).bytes(block); blen = 0; }
  };
  const emit = (code) => {
    bitBuf |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) { flushByte(bitBuf & 255); bitBuf >>>= 8; bitCount -= 8; }
  };
  out.u8(minCodeSize);
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const c = indices[i];
    const key = prefix * 256 + c;
    const hit = dict.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix);
    if (next < 4096) {
      dict.set(key, next++);
      // Grow after the code that needs the wider size has been assigned.
      if (next > (1 << codeSize) && codeSize < 12) codeSize++;
    } else {
      emit(clear);
      dict = new Map();
      codeSize = minCodeSize + 1;
      next = eoi + 1;
    }
    prefix = c;
  }
  emit(prefix);
  emit(eoi);
  if (bitCount > 0) flushByte(bitBuf & 255);
  if (blen) out.u8(blen).bytes(block.subarray(0, blen));
  out.u8(0);
  return out.out();
}

export class GIFEncoder {
  /**
   * @param {number} w @param {number} h @param {number} fps
   * @param {{ palette: Uint8Array, lut: Uint8Array }} pal
   * @param {boolean} transparent
   */
  constructor(w, h, fps, pal, transparent) {
    this.w = w; this.h = h; this.fps = fps;
    this.pal = pal;
    this.transparent = transparent;
    this.frame = 0;
    const colors = pal.palette.length / 3 + (transparent ? 1 : 0);
    this.bits = Math.max(1, Math.ceil(Math.log2(Math.max(2, colors))));
    this.transIndex = pal.palette.length / 3;
    const head = new Writer(1024);
    head.ascii('GIF89a').u16le(w).u16le(h)
      .u8(0x80 | ((this.bits - 1) << 4) | (this.bits - 1)) // global table, colour resolution, size
      .u8(0).u8(0);
    const table = new Uint8Array(3 << this.bits);
    table.set(pal.palette);
    head.bytes(table);
    // Netscape extension: loop forever.
    head.u8(0x21).u8(0xff).u8(11).ascii('NETSCAPE2.0').u8(3).u8(1).u16le(0).u8(0);
    this.parts = [head.out()];
    this.indices = new Uint8Array(w * h);
  }

  /** @param {Uint8Array} rgba */
  addFrame(rgba) {
    const { lut } = this.pal;
    const idx = this.indices;
    const t = this.transparent;
    for (let i = 0, p = 0; i < idx.length; i++, p += 4) {
      if (t && rgba[p + 3] < ALPHA_CUT) { idx[i] = this.transIndex; continue; }
      idx[i] = lut[((rgba[p] >> 3) << 10) | ((rgba[p + 1] >> 3) << 5) | (rgba[p + 2] >> 3)];
    }
    // GIF delays are in 1/100 s; spread the rounding so the average rate is exact.
    const f = this.frame++;
    const delay = Math.round(((f + 1) * 100) / this.fps) - Math.round((f * 100) / this.fps);
    const gce = new Writer(8).u8(0x21).u8(0xf9).u8(4)
      .u8(((t ? 2 : 1) << 2) | (t ? 1 : 0)) // disposal: restore to background if transparent
      .u16le(delay).u8(t ? this.transIndex : 0).u8(0).out();
    const desc = new Writer(10).u8(0x2c).u16le(0).u16le(0).u16le(this.w).u16le(this.h).u8(0).out();
    this.parts.push(gce, desc, lzwEncode(idx, Math.max(2, this.bits)));
  }

  finish() {
    return new Blob([...this.parts, new Uint8Array([0x3b])], { type: 'image/gif' });
  }
}
