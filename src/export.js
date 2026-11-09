// Exporters: PNG, SVG, video (WebM/MP4) and JSON.
import { Renderer } from './renderer.js';
import { frameAt } from './scene.js';
import { evalFieldWeights } from './field.js';
import { marchingSquares, simplifyLoop, loopToPath } from './contour.js';

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

export function videoSupport() {
  if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) return null;
  const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4;codecs=avc1', 'video/mp4'];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || null;
}

/**
 * Record exactly one loop of the animation in real time.
 * @returns {Promise<{blob: Blob, ext: string}>}
 */
export function recordVideo(doc, { maxSide = 1920, loops = 1, onProgress, signal } = {}) {
  const mime = videoSupport();
  if (!mime) return Promise.reject(new Error('Video recording is not supported in this browser.'));
  const s = Math.min(1, maxSide / Math.max(doc.board.w, doc.board.h));
  // Even dimensions keep H.264/VP9 encoders happy.
  const w = Math.max(2, Math.round((doc.board.w * s) / 2) * 2);
  const h = Math.max(2, Math.round((doc.board.h * s) / 2) * 2);
  const opaque = { ...doc, transparent: false };
  const canvas = renderBoard(opaque, 0, w, h, { transparent: false });
  const stream = canvas.captureStream(60);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 16_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const duration = doc.loop * loops * 1000;

  return new Promise((resolve, reject) => {
    let raf = 0;
    let start = 0;
    let cancelled = false;
    const finish = () => {
      cancelAnimationFrame(raf);
      if (rec.state !== 'inactive') rec.stop();
    };
    let started = false;
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (cancelled) return reject(new DOMException('Recording cancelled', 'AbortError'));
      const blob = new Blob(chunks, { type: mime.split(';')[0] });
      if (!blob.size) return reject(new Error('The browser produced an empty video. Please try again.'));
      resolve({ blob, ext: mime.includes('mp4') ? 'mp4' : 'webm' });
    };
    rec.onerror = (e) => { cancelAnimationFrame(raf); reject(e.error || new Error('Recording failed')); };
    // The encoder can take a moment to spin up; the timeline starts only once
    // it is actually recording, so the first frames of the loop are not lost.
    rec.onstart = () => { started = true; };
    signal?.addEventListener('abort', () => { cancelled = true; finish(); }, { once: true });

    const tick = (now) => {
      if (!started) {
        renderBoard(opaque, 0, w, h, { transparent: false });
        raf = requestAnimationFrame(tick);
        return;
      }
      if (!start) start = now;
      const el = now - start;
      const t = Math.min(el, duration) / 1000;
      renderBoard(opaque, t, w, h, { transparent: false });
      onProgress?.(Math.min(el / duration, 1));
      if (el >= duration) {
        // One more frame period so the last frame is captured.
        setTimeout(finish, 50);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    rec.start(250);
    raf = requestAnimationFrame(tick);
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
