// PNG and APNG (animated PNG) encoders for straight-alpha RGBA frames.
import { Writer, crc32, zlibDeflate } from './bytes.js';

const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function chunk(type, data) {
  const w = new Writer(data.length + 12);
  w.u32(data.length).ascii(type).bytes(data);
  const body = w.buf.subarray(4, 8 + data.length);
  return w.u32(crc32(body)).out();
}

function ihdr(w, h) {
  // 8-bit RGBA, deflate, adaptive filtering, no interlace.
  return chunk('IHDR', new Writer(13).u32(w).u32(h).u8(8).u8(6).u8(0).u8(0).u8(0).out());
}

/**
 * Filter scanlines (per-row choice of None/Sub/Up/Paeth by the usual minimum
 * sum of absolute differences) and zlib-compress them.
 * @param {Uint8Array} rgba top-down rows, straight alpha
 */
export async function pngImageData(rgba, w, h) {
  const stride = w * 4;
  const out = new Uint8Array((stride + 1) * h);
  const cand = [new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride)];
  for (let y = 0; y < h; y++) {
    const row = y * stride;
    const prev = y > 0 ? row - stride : -1;
    const [sub, up, pa] = cand;
    let sSub = 0, sUp = 0, sPa = 0, sNone = 0;
    for (let i = 0; i < stride; i++) {
      const x = rgba[row + i];
      const a = i >= 4 ? rgba[row + i - 4] : 0;
      const b = prev >= 0 ? rgba[prev + i] : 0;
      const c = prev >= 0 && i >= 4 ? rgba[prev + i - 4] : 0;
      const p = a + b - c;
      const da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
      const pred = da <= db && da <= dc ? a : db <= dc ? b : c;
      const vs = (x - a) & 255, vu = (x - b) & 255, vp = (x - pred) & 255;
      sub[i] = vs; up[i] = vu; pa[i] = vp;
      sNone += x < 128 ? x : 256 - x;
      sSub += vs < 128 ? vs : 256 - vs;
      sUp += vu < 128 ? vu : 256 - vu;
      sPa += vp < 128 ? vp : 256 - vp;
    }
    const o = y * (stride + 1);
    let best = 0, bestS = sNone;
    if (sSub < bestS) { best = 1; bestS = sSub; }
    if (sUp < bestS) { best = 2; bestS = sUp; }
    if (sPa < bestS) { best = 4; bestS = sPa; }
    out[o] = best;
    if (best === 0) out.set(rgba.subarray(row, row + stride), o + 1);
    else out.set(best === 1 ? sub : best === 2 ? up : pa, o + 1);
  }
  return zlibDeflate(out);
}

/** A complete PNG file. */
export async function encodePNG(rgba, w, h) {
  const data = await pngImageData(rgba, w, h);
  return new Blob([SIGNATURE, ihdr(w, h), chunk('IDAT', data), chunk('IEND', new Uint8Array(0))], { type: 'image/png' });
}

/**
 * Animated PNG. Every frame covers the full image and replaces the previous
 * one (blend SOURCE), so transparent areas stay transparent. Loops forever.
 */
export class APNGEncoder {
  constructor(w, h, fps) {
    this.w = w; this.h = h;
    this.fps = fps;
    this.frames = 0;
    this.seq = 0;
    this.parts = [];
  }

  async addFrame(rgba) {
    const data = await pngImageData(rgba, this.w, this.h);
    const fctl = new Writer(26)
      .u32(this.seq++).u32(this.w).u32(this.h).u32(0).u32(0)
      .u16(1).u16(this.fps) // delay = 1/fps s
      .u8(0) // dispose: none (the next frame replaces every pixel anyway)
      .u8(0) // blend: source
      .out();
    this.parts.push(chunk('fcTL', fctl));
    if (this.frames === 0) {
      this.parts.push(chunk('IDAT', data));
    } else {
      const fd = new Uint8Array(data.length + 4);
      new DataView(fd.buffer).setUint32(0, this.seq++);
      fd.set(data, 4);
      this.parts.push(chunk('fdAT', fd));
    }
    this.frames++;
  }

  finish() {
    const actl = chunk('acTL', new Writer(8).u32(this.frames).u32(0).out());
    return new Blob([SIGNATURE, ihdr(this.w, this.h), actl, ...this.parts, chunk('IEND', new Uint8Array(0))], { type: 'image/apng' });
  }
}
