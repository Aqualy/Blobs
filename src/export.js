// Exporters: PNG, SVG, animation (MP4, WebM with alpha, GIF, APNG, PNG frames).
import { Renderer } from './renderer.js';
import { frameAt } from './scene.js';
import { evalFieldWeights } from './field.js';
import { marchingSquares, simplifyLoop, loopToPath } from './contour.js';
import { WebMMuxer } from './encode/webm.js';
import { MP4Muxer } from './encode/mp4.js';
import { GIFEncoder, buildPalette } from './encode/gif.js';
import { APNGEncoder, encodePNG } from './encode/png.js';
import { ZipWriter } from './encode/zip.js';

let off = null; // { canvas, renderer }

function offscreen() {
  if (off && !off.renderer.lost) return off;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 16;
  // Kept in the DOM (off-screen) so captureStream works in every browser.
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;left:-100000px;top:0;width:16px;height:16px;pointer-events:none;';
  document.body.appendChild(canvas);
  off = { canvas, renderer: new Renderer(canvas, { preserve: true }) };
  return off;
}

export function maxExportSide() {
  const { renderer } = offscreen();
  const gl = renderer.gl;
  const dims = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
  return Math.min(8192, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), dims[0], dims[1]);
}

function renderBoard(doc, time, w, h, { transparent }) {
  const { canvas, renderer } = offscreen();
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const { blobs, pairs } = frameAt(doc, time);
  renderer.render({
    blobs, pairs, params: doc.params,
    view: { scale: w / doc.board.w, ox: 0, oy: 0 },
    board: doc.board,
    background: doc.background,
    transparent,
    checker: false,
    clip: true,
  });
  return canvas;
}

export async function exportPNG(doc, time, scale = 1) {
  const limit = maxExportSide();
  const s = Math.min(scale, limit / Math.max(doc.board.w, doc.board.h));
  const w = Math.max(1, Math.round(doc.board.w * s));
  const h = Math.max(1, Math.round(doc.board.h * s));
  const canvas = renderBoard(doc, time, w, h, { transparent: doc.transparent });
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('The browser could not encode the PNG.');
  return blob;
}

const nextFrame = () => new Promise((r) => setTimeout(r, 0));

/** Vector export: marching squares on the CPU field, one path per colour region. */
export async function exportSVG(doc, time, { onProgress } = {}) {
  const { blobs, pairs } = frameAt(doc, time);
  const W = doc.board.w, H = doc.board.h;
  const step = Math.max(W, H) / 1100;
  const nx = Math.ceil((W + 2 * step) / step) + 1;
  const ny = Math.ceil((H + 2 * step) / step) + 1;

  const colors = [];
  const colorIndex = new Int32Array(blobs.length);
  blobs.forEach((b, i) => {
    let c = colors.indexOf(b.color);
    if (c < 0) { c = colors.length; colors.push(b.color); }
    colorIndex[i] = c;
  });
  const nc = Math.max(colors.length, 1);
  const f = new Float32Array(nx * ny);
  const wg = nc > 1 ? new Float32Array(nx * ny * nc) : null;
  const w = new Float32Array(nc);
  const totals = new Float64Array(nc);

  for (let j = 0; j < ny; j++) {
    const y = -step + j * step;
    for (let i = 0; i < nx; i++) {
      const x = -step + i * step;
      const idx = j * nx + i;
      if (!blobs.length) { f[idx] = 1; continue; }
      let d = evalFieldWeights(x, y, blobs, pairs, doc.params, colorIndex, w);
      const box = Math.min(x, W - x, y, H - y);
      d = Math.max(d, -box);
      if (i === 0 || j === 0 || i === nx - 1 || j === ny - 1) d = Math.max(d, step);
      f[idx] = d;
      if (wg) {
        wg.set(w, idx * nc);
        if (d < 0) for (let c = 0; c < nc; c++) totals[c] += w[c];
      }
    }
    if (j % 40 === 0) { onProgress?.(j / ny); await nextFrame(); }
  }

  const toPath = (grid) => marchingSquares(grid, nx, ny)
    .map((l) => loopToPath(simplifyLoop(l, 0.12), step, step, -step, -step))
    .join('');

  const parts = [];
  const bg = doc.transparent ? '' : `<rect width="${W}" height="${H}" fill="${doc.background}"/>`;
  if (blobs.length) {
    if (!wg) {
      parts.push(`<path fill="${colors[0]}" fill-rule="evenodd" d="${toPath(f)}"/>`);
    } else {
      // Base layer: full union in the dominant colour (prevents seams).
      let dom = 0;
      for (let c = 1; c < nc; c++) if (totals[c] > totals[dom]) dom = c;
      parts.push(`<path fill="${colors[dom]}" fill-rule="evenodd" d="${toPath(f)}"/>`);
      // One region per other colour: where it owns the largest weight.
      const g = new Float32Array(nx * ny);
      const S = step * 40;
      for (let c = 0; c < nc; c++) {
        if (c === dom) continue;
        for (let idx = 0; idx < nx * ny; idx++) {
          let other = 0;
          const o = idx * nc;
          for (let k = 0; k < nc; k++) if (k !== c && wg[o + k] > other) other = wg[o + k];
          g[idx] = Math.max(f[idx], (other - wg[o + c]) * S);
        }
        const d = toPath(g);
        if (d) parts.push(`<path fill="${colors[c]}" fill-rule="evenodd" d="${d}"/>`);
        await nextFrame();
      }
    }
  }
  onProgress?.(1);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${bg}${parts.join('')}</svg>\n`;
}

// ---------------------------------------------------------------- animation

/**
 * Animation formats. `alpha`: can hold a transparent background ('full' or
 * '1bit'). `maxSide`: longest side in pixels. `maxFps`: GIF delays are in
 * 1/100 s and browsers slow down anything faster than 50 fps.
 */
export const ANIMATION_FORMATS = {
  mp4: { label: 'MP4', ext: 'mp4', alpha: null, maxSide: 1920, maxFps: 60, note: 'H.264. Plays everywhere.' },
  webm: { label: 'WebM', ext: 'webm', alpha: 'full', maxSide: 1920, maxFps: 60, note: 'VP9. Keeps transparency in Chrome, Edge, Firefox and ffmpeg.' },
  gif: { label: 'GIF', ext: 'gif', alpha: '1bit', maxSide: 720, maxFps: 50, note: '256 colours; transparent edges are hard (no soft alpha).' },
  apng: { label: 'APNG', ext: 'png', alpha: 'full', maxSide: 1080, maxFps: 60, note: 'Animated PNG: lossless with soft transparency, plays in browsers.' },
  png: { label: 'PNG frames', ext: 'zip', alpha: 'full', maxSide: 1920, maxFps: 60, note: 'ZIP of numbered PNGs, for After Effects, Premiere or ffmpeg.' },
};

export const FRAME_RATES = [12, 24, 25, 30, 50, 60];

const H264 = ['avc1.640033', 'avc1.640034', 'avc1.4d0033', 'avc1.42e033', 'avc1.640028', 'avc1.42e028', 'avc1.42e01f'];
const VPX = ['vp09.00.51.08', 'vp09.00.41.08', 'vp09.00.40.08', 'vp09.00.31.08', 'vp8'];

/** Output size for a format: board aspect, longest side capped, even sides for video encoders. */
export function animationSize(doc, format) {
  const f = ANIMATION_FORMATS[format];
  const s = Math.min(1, f.maxSide / Math.max(doc.board.w, doc.board.h));
  const even = format === 'mp4' || format === 'webm';
  const round = (v) => (even ? Math.max(2, Math.round(v / 2) * 2) : Math.max(1, Math.round(v)));
  return { w: round(doc.board.w * s), h: round(doc.board.h * s) };
}

function encoderConfig(codec, w, h, fps) {
  const bitrate = Math.round(Math.min(40e6, Math.max(2e6, w * h * fps * 0.16)));
  const c = { codec, width: w, height: h, framerate: fps, bitrate, bitrateMode: 'variable', latencyMode: 'quality' };
  if (codec.startsWith('avc1')) c.avc = { format: 'avc' };
  return c;
}

async function pickCodec(list, w, h, fps) {
  if (typeof VideoEncoder === 'undefined') return null;
  for (const codec of list) {
    try {
      const r = await VideoEncoder.isConfigSupported(encoderConfig(codec, w, h, fps));
      if (r.supported) return r.config;
    } catch { /* try the next one */ }
  }
  return null;
}

function recorderMime(kind) {
  if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) return null;
  const types = kind === 'mp4' ? ['video/mp4;codecs=avc1', 'video/mp4'] : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || null;
}

/**
 * What this browser can export.
 * @returns {Promise<Record<string, {ok: boolean, alpha: boolean, realtime?: boolean}>>}
 */
export async function animationSupport(doc) {
  const out = {};
  const deflate = typeof CompressionStream !== 'undefined';
  for (const [k, f] of Object.entries(ANIMATION_FORMATS)) {
    const { w, h } = animationSize(doc, k);
    if (k === 'mp4' || k === 'webm') {
      const wc = await pickCodec(k === 'mp4' ? H264 : VPX, w, h, 30);
      const rec = !wc && recorderMime(k);
      // Alpha needs WebCodecs: the alpha plane is a second encoded stream.
      out[k] = { ok: !!(wc || rec), alpha: !!wc && !!f.alpha, realtime: !wc && !!rec };
    } else {
      out[k] = { ok: k === 'gif' || deflate, alpha: true };
    }
  }
  return out;
}

const abortError = () => new DOMException('Export cancelled', 'AbortError');

/** Read the offscreen canvas as top-down straight-alpha RGBA. */
function readRGBA(w, h) {
  const gl = off.renderer.gl;
  const flipped = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, flipped);
  const out = new Uint8Array(flipped.length);
  const stride = w * 4;
  for (let y = 0; y < h; y++) out.set(flipped.subarray((h - 1 - y) * stride, (h - y) * stride), y * stride);
  return out;
}

/**
 * Fully transparent pixels have RGB = 0. Chroma subsampling would bleed that
 * black into soft edges, so give them the colour of the nearest visible pixel
 * in their row (or the row above).
 */
function bleedColour(px, w, h) {
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    let last = -1, first = -1;
    for (let x = 0; x < w; x++) {
      const i = row + x * 4;
      if (px[i + 3] > 0) { last = i; if (first < 0) first = i; }
      else if (last >= 0) { px[i] = px[last]; px[i + 1] = px[last + 1]; px[i + 2] = px[last + 2]; }
    }
    if (first < 0) {
      if (y > 0) px.copyWithin(row, row - w * 4, row);
      continue;
    }
    for (let i = row; i < first; i += 4) { px[i] = px[first]; px[i + 1] = px[first + 1]; px[i + 2] = px[first + 2]; }
  }
  // Empty rows copied the alpha of the row above too; that is harmless because
  // the alpha plane is taken before this runs and the colour encoder drops alpha.
}

/**
 * Colour spaces of encoded frames (tagged in the containers too). H.264 gets
 * BT.709. VP9 encoders leave the bitstream's colour space "unknown", which
 * decoders such as ffmpeg read as BT.601, so WebM uses the BT.601 matrix.
 */
const BT709 = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false };
const BT601 = { primaries: 'bt709', transfer: 'bt709', matrix: 'smpte170m', fullRange: false };
const KR_KB = { bt709: [0.2126, 0.0722], smpte170m: [0.299, 0.114] };

/**
 * RGB → I420, limited range, done here rather than by the encoder: browsers
 * convert with different (and untagged) ranges, which made exported colours
 * too contrasty in players.
 * @param {'bt709'|'smpte170m'} matrix
 */
export function rgbaToI420(px, w, h, matrix = 'bt709') {
  const [kr, kb] = KR_KB[matrix];
  const kg = 1 - kr - kb;
  const n = w * h, cw = w >> 1, ch = h >> 1;
  const buf = new Uint8Array(n + 2 * cw * ch);
  // Y = 16 + 219·(kr R + kg G + kb B), fixed point ×2^16.
  const YR = Math.round(kr * 219 / 255 * 65536), YG = Math.round(kg * 219 / 255 * 65536), YB = Math.round(kb * 219 / 255 * 65536);
  for (let i = 0, p = 0; i < n; i++, p += 4) buf[i] = 16 + ((YR * px[p] + YG * px[p + 1] + YB * px[p + 2] + 32768) >> 16);
  // Chroma from the 2×2 average: Cb = 224·(B − Y')/(2(1−kb)), Cr = 224·(R − Y')/(2(1−kr)).
  const db = 2 * (1 - kb), dr = 2 * (1 - kr);
  const u0 = n, v0 = n + cw * ch;
  const k = 224 / 255 / 4;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const a = ((2 * y) * w + 2 * x) * 4, b = a + w * 4;
      const r = px[a] + px[a + 4] + px[b] + px[b + 4];
      const g = px[a + 1] + px[a + 5] + px[b + 1] + px[b + 5];
      const bl = px[a + 2] + px[a + 6] + px[b + 2] + px[b + 6];
      const yl = kr * r + kg * g + kb * bl;
      const cb = 128 + (k * (bl - yl)) / db;
      const cr = 128 + (k * (r - yl)) / dr;
      buf[u0 + y * cw + x] = cb < 0 ? 0 : cb > 255 ? 255 : Math.round(cb);
      buf[v0 + y * cw + x] = cr < 0 ? 0 : cr > 255 ? 255 : Math.round(cr);
    }
  }
  return buf;
}

function alphaPlane(px, w, h) {
  // I420 frame whose luma is the alpha channel; chroma neutral.
  const n = w * h;
  const buf = new Uint8Array(n + n / 2);
  for (let i = 0; i < n; i++) buf[i] = px[i * 4 + 3];
  buf.fill(128, n);
  return buf;
}

function webCodecsEncoder(config, onChunk) {
  let failed = null;
  const enc = new VideoEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      onChunk(data, chunk.type === 'key', meta);
    },
    error: (e) => { failed = e; },
  });
  enc.configure(config);
  return {
    enc,
    check() { if (failed) throw failed; },
    async room() {
      while (enc.encodeQueueSize > 3) {
        await new Promise((r) => {
          const t = setTimeout(r, 20);
          enc.addEventListener('dequeue', () => { clearTimeout(t); r(); }, { once: true });
        });
      }
      this.check();
    },
  };
}

/** Sink for MP4 / WebM through WebCodecs and the muxers in ./encode. */
async function videoSink(format, w, h, fps, transparent) {
  const config = await pickCodec(format === 'mp4' ? H264 : VPX, w, h, fps);
  if (!config) return null;
  const alpha = transparent && format === 'webm';
  const keyEvery = Math.max(1, Math.round(fps * 2));
  const colour = [], alphaChunks = [];
  let description = null;
  const main = webCodecsEncoder(config, (data, key, meta) => {
    if (meta?.decoderConfig?.description && !description) {
      const d = meta.decoderConfig.description;
      description = d instanceof ArrayBuffer ? new Uint8Array(d) : new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
      description = description.slice();
    }
    colour.push({ data, key });
  });
  const side = alpha ? webCodecsEncoder({ ...config, bitrate: Math.round(config.bitrate / 2) }, (data) => alphaChunks.push(data)) : null;
  const ts = (i) => Math.round((i * 1e6) / fps);
  const dur = Math.round(1e6 / fps);

  const space = format === 'mp4' ? BT709 : BT601;
  const i420 = (data, i, colorSpace) => new VideoFrame(data, {
    format: 'I420', codedWidth: w, codedHeight: h, timestamp: ts(i), duration: dur, colorSpace,
  });

  return {
    needsPixels: true,
    async add(canvas, i, px) {
      await main.room();
      if (side) await side.room();
      const keyFrame = i % keyEvery === 0;
      if (alpha) {
        const af = i420(alphaPlane(px, w, h), i, { ...space, fullRange: true });
        side.enc.encode(af, { keyFrame });
        af.close();
        bleedColour(px, w, h);
      }
      const frame = i420(rgbaToI420(px, w, h, space.matrix), i, space);
      main.enc.encode(frame, { keyFrame });
      frame.close();
    },
    async finish() {
      await main.enc.flush();
      if (side) await side.enc.flush();
      main.check();
      side?.check();
      main.enc.close();
      side?.enc.close();
      if (format === 'mp4') {
        const mux = new MP4Muxer({ width: w, height: h, fps });
        colour.forEach((c, i) => mux.addFrame(c.data, c.key, i === 0 ? description : undefined));
        return mux.finish();
      }
      const mux = new WebMMuxer({ width: w, height: h, fps, codec: config.codec === 'vp8' ? 'V_VP8' : 'V_VP9', alpha });
      colour.forEach((c, i) => mux.addFrame(c.data, i, c.key, alpha ? alphaChunks[i] : undefined));
      return mux.finish();
    },
  };
}

async function imageSink(format, doc, w, h, fps, transparent, frames, renderAt) {
  if (format === 'apng') {
    const enc = new APNGEncoder(w, h, fps);
    return { needsPixels: true, add: (c, i, px) => enc.addFrame(px), finish: async () => enc.finish() };
  }
  if (format === 'png') {
    const zip = new ZipWriter();
    const digits = Math.max(4, String(frames - 1).length);
    return {
      needsPixels: true,
      async add(c, i, px) {
        const png = await encodePNG(px, w, h);
        zip.add(`blobs_${String(i).padStart(digits, '0')}.png`, new Uint8Array(await png.arrayBuffer()));
      },
      finish: async () => zip.finish(),
    };
  }
  // GIF: one palette from frames spread over the loop.
  const samples = [];
  const n = Math.min(frames, 16);
  for (let s = 0; s < n; s++) samples.push(renderAt(Math.floor((s * frames) / n)));
  const pal = buildPalette(samples, transparent ? 255 : 256, transparent);
  const enc = new GIFEncoder(w, h, fps, pal, transparent);
  return { needsPixels: true, add: (c, i, px) => enc.addFrame(px), finish: async () => enc.finish() };
}

/**
 * Render one seamless loop frame by frame (faster than real time where the
 * browser has WebCodecs) and encode it.
 * @param {object} doc
 * @param {{ format: keyof ANIMATION_FORMATS, fps: number, transparent: boolean,
 *   onProgress?: (p: number) => void, signal?: AbortSignal }} o
 * @returns {Promise<{ blob: Blob, ext: string }>}
 */
export async function exportAnimation(doc, { format, fps, transparent, onProgress, signal }) {
  const f = ANIMATION_FORMATS[format];
  if (!f) throw new Error(`Unknown format "${format}".`);
  fps = Math.min(f.maxFps, Math.max(1, Math.round(fps)));
  transparent = !!transparent && !!f.alpha;
  const { w, h } = animationSize(doc, format);
  const frames = Math.max(1, Math.round(doc.loop * fps));
  const renderAt = (i) => {
    renderBoard(doc, i / fps, w, h, { transparent });
    return readRGBA(w, h);
  };

  let sink;
  if (format === 'mp4' || format === 'webm') {
    sink = await videoSink(format, w, h, fps, transparent);
    if (!sink) {
      // No WebCodecs: fall back to real-time recording (opaque only).
      if (transparent) throw new Error('Transparent WebM needs a browser with WebCodecs (Chrome, Edge, Firefox 130+, Safari 17+).');
      return recordVideo(doc, { kind: format, fps, w, h, onProgress, signal });
    }
  } else {
    sink = await imageSink(format, doc, w, h, fps, transparent, frames, renderAt);
  }

  let lastYield = performance.now();
  for (let i = 0; i < frames; i++) {
    if (signal?.aborted) throw abortError();
    const canvas = renderBoard(doc, i / fps, w, h, { transparent });
    const px = sink.needsPixels ? readRGBA(w, h) : null;
    await sink.add(canvas, i, px);
    onProgress?.((i + 1) / frames, i + 1, frames);
    if (performance.now() - lastYield > 30) { await nextFrame(); lastYield = performance.now(); }
  }
  if (signal?.aborted) throw abortError();
  const blob = await sink.finish();
  if (!blob.size) throw new Error('The encoder produced an empty file.');
  return { blob, ext: f.ext };
}

/**
 * Fallback for browsers without WebCodecs: record one loop in real time with
 * MediaRecorder at the requested frame rate.
 */
function recordVideo(doc, { kind, fps, w, h, onProgress, signal }) {
  const mime = recorderMime(kind);
  if (!mime) return Promise.reject(new Error(`${kind.toUpperCase()} video is not supported in this browser.`));
  const opaque = { ...doc, transparent: false };
  const canvas = renderBoard(opaque, 0, w, h, { transparent: false });
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 16_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const duration = doc.loop * 1000;
  const frames = Math.max(1, Math.round(doc.loop * fps));

  return new Promise((resolve, reject) => {
    let timer = 0;
    let cancelled = false;
    let started = false;
    let start = 0;
    let shown = -1;
    const finish = () => {
      clearInterval(timer);
      if (rec.state !== 'inactive') rec.stop();
    };
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (cancelled) return reject(abortError());
      const blob = new Blob(chunks, { type: mime.split(';')[0] });
      if (!blob.size) return reject(new Error('The browser produced an empty video. Please try again.'));
      resolve({ blob, ext: mime.includes('mp4') ? 'mp4' : 'webm' });
    };
    rec.onerror = (e) => { clearInterval(timer); reject(e.error || new Error('Recording failed')); };
    // The encoder can take a moment to spin up; the timeline starts only once
    // it is actually recording, so the first frames of the loop are not lost.
    rec.onstart = () => { started = true; };
    signal?.addEventListener('abort', () => { cancelled = true; finish(); }, { once: true });

    const tick = () => {
      if (!started) return;
      const now = performance.now();
      if (!start) start = now;
      const el = now - start;
      const i = Math.min(frames, Math.floor((el / 1000) * fps));
      if (i !== shown && i < frames) {
        shown = i;
        renderBoard(opaque, i / fps, w, h, { transparent: false });
        track.requestFrame?.();
      }
      onProgress?.(Math.min(el / duration, 1), Math.min(i, frames), frames);
      if (el >= duration) finish();
    };
    rec.start(250);
    timer = setInterval(tick, Math.max(4, 500 / fps));
  });
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
