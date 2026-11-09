// Blobs — editor application.
import { DEFAULT_PARAMS, PARAM_RANGES, LIMITS } from './field.js';
import {
  PALETTE, BOARD_PRESETS, MOTION_TYPES, PRESETS,
  emptyDoc, normalizeDoc, makeBlob, nextBlobId, isAnimated,
} from './model.js';
import { Renderer } from './renderer.js';
import { frameAt } from './scene.js';
import { exportPNG, exportSVG, recordVideo, videoSupport, download } from './export.js';

const $ = (s, root = document) => root.querySelector(s);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const round2 = (v) => Math.round(v * 100) / 100;
const STORAGE_KEY = 'blobs:doc:v1';
const HINT_KEY = 'blobs:hinted';
const STAGE_COLOR = '#0f0f10';

// ---------------------------------------------------------------- state
let doc = null;
const state = {
  time: 0,
  playing: false,
  selection: new Set(),
  hover: null,
  view: { zoom: 1, x: 0, y: 0 },   // screen(css px) = board * zoom + (x, y)
  frame: { blobs: [], pairs: [] },
  drag: null,
  spaceDown: false,
  spaceUsed: false,
  autoFit: true,
  lastRadius: null,
  lastColor: PALETTE[0],
  pngScale: 1,
  exporting: null,
};

// ---------------------------------------------------------------- dom
const stage = $('#stage');
const glCanvas = $('#gl');
const overlay = $('#overlay');
const octx = overlay.getContext('2d');
let renderer = null;
let dpr = 1;

function fatal(msg) {
  const el = $('#fatal');
  el.hidden = false;
  el.textContent = msg;
}

try {
  renderer = new Renderer(glCanvas);
} catch (err) {
  console.error(err);
  fatal('Blobs needs WebGL2, which is not available here. Try an up-to-date Chrome, Edge, Firefox or Safari, and make sure hardware acceleration is enabled.');
}

// ---------------------------------------------------------------- toasts
function toast(msg, { error = false, ms = 2600 } = {}) {
  const el = document.createElement('div');
  el.className = 'toast' + (error ? ' error' : '');
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, ms);
}

// ---------------------------------------------------------------- history
const history = { stack: [], index: -1 };

function commit() {
  const snap = JSON.stringify(doc);
  if (history.stack[history.index] === snap) return;
  history.stack.length = history.index + 1;
  history.stack.push(snap);
  if (history.stack.length > 300) history.stack.shift();
  history.index = history.stack.length - 1;
  updateUndoButtons();
  scheduleSave();
}

function restore(snap) {
  doc = JSON.parse(snap);
  const ids = new Set(doc.blobs.map((b) => b.id));
  for (const id of [...state.selection]) if (!ids.has(id)) state.selection.delete(id);
  state.time = state.time % doc.loop;
  syncPanel();
  updateUndoButtons();
  scheduleSave();
  requestRender();
}

function undo() { if (history.index > 0) restore(history.stack[--history.index]); }
function redo() { if (history.index < history.stack.length - 1) restore(history.stack[++history.index]); }
function updateUndoButtons() {
  $('#undo').disabled = history.index <= 0;
  $('#redo').disabled = history.index >= history.stack.length - 1;
}

// ---------------------------------------------------------------- persistence
let saveTimer = 0;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(doc)); } catch { /* storage unavailable */ }
  }, 300);
}

function b64urlEncode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
async function encodeDoc(d) {
  const json = JSON.stringify(d);
  if (typeof CompressionStream !== 'undefined') {
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return 'z' + b64urlEncode(new Uint8Array(await new Response(stream).arrayBuffer()));
  }
  return 'j' + b64urlEncode(new TextEncoder().encode(json));
}
async function decodeDoc(str) {
  const kind = str[0];
  const bytes = b64urlDecode(str.slice(1));
  if (kind === 'z') {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return JSON.parse(await new Response(stream).text());
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

// ---------------------------------------------------------------- view
function screenToBoard(sx, sy) {
  const v = state.view;
  return { x: (sx - v.x) / v.zoom, y: (sy - v.y) / v.zoom };
}
function stageSize() {
  return { w: stage.clientWidth, h: stage.clientHeight };
}
function fitView() {
  const { w, h } = stageSize();
  const m = Math.min(56, Math.min(w, h) * 0.08);
  const zoom = clamp(Math.min((w - 2 * m) / doc.board.w, (h - 2 * m) / doc.board.h), 0.02, 16);
  state.view.zoom = zoom;
  state.view.x = (w - doc.board.w * zoom) / 2;
  state.view.y = (h - doc.board.h * zoom) / 2;
  state.autoFit = true;
  updateZoomLabel();
  requestRender();
}
function zoomAt(sx, sy, factor) {
  const v = state.view;
  const z = clamp(v.zoom * factor, 0.02, 16);
  const f = z / v.zoom;
  v.x = sx - (sx - v.x) * f;
  v.y = sy - (sy - v.y) * f;
  v.zoom = z;
  state.autoFit = false;
  updateZoomLabel();
  requestRender();
}
function updateZoomLabel() {
  $('#zoom-label').textContent = Math.round(state.view.zoom * 100) + '%';
}

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const { w, h } = stageSize();
  const W = Math.max(1, Math.round(w * dpr));
  const H = Math.max(1, Math.round(h * dpr));
  if (glCanvas.width !== W || glCanvas.height !== H) {
    const hadSize = glCanvas.width > 1;
    const old = { w: glCanvas.width / dpr, h: glCanvas.height / dpr };
    glCanvas.width = overlay.width = W;
    glCanvas.height = overlay.height = H;
    if (hadSize && doc && state.autoFit) {
      fitView();
    } else if (hadSize && doc) {
      // Keep the composition centred while the window resizes.
      state.view.x += (w - old.w) / 2;
      state.view.y += (h - old.h) / 2;
    }
  }
  requestRender();
}

// ---------------------------------------------------------------- render loop
let rafId = 0;
let lastTs = 0;
function requestRender() {
  if (!rafId) rafId = requestAnimationFrame(loop);
}
function loop(ts) {
  rafId = 0;
  if (state.playing) {
    // Clamp dt so returning to a background tab never jumps the animation.
    const dt = lastTs ? Math.min((ts - lastTs) / 1000, 1 / 20) : 0;
    lastTs = ts;
    state.time = (state.time + dt) % doc.loop;
  } else {
    lastTs = 0;
  }
  draw();
  if (state.playing) requestRender();
}

function draw() {
  if (!doc) return;
  const fr = frameAt(doc, state.time);
  state.frame = fr;
  if (renderer) {
    const v = state.view;
    renderer.render({
      blobs: fr.blobs, pairs: fr.pairs, params: doc.params,
      view: { scale: v.zoom * dpr, ox: v.x * dpr, oy: v.y * dpr },
      board: doc.board,
      background: doc.background,
      transparent: doc.transparent,
      checker: true,
      clip: true,
      stage: STAGE_COLOR,
    });
  }
  drawOverlay(fr);
  updateClock();
}

const KNOB_ANGLE = -Math.PI / 4;
function knobPos(b) {
  const v = state.view;
  return {
    x: (b.x + Math.cos(KNOB_ANGLE) * b.r) * v.zoom + v.x,
    y: (b.y + Math.sin(KNOB_ANGLE) * b.r) * v.zoom + v.y,
  };
}

function motionPath(src) {
  // Sample the resolved path of a blob across one loop.
  const pts = [];
  const N = 96;
  const tmp = { ...src, motion: { ...src.motion, pulse: 0 } };
  const one = { ...doc, blobs: [tmp] };
  for (let i = 0; i <= N; i++) {
    const b = frameAt(one, (i / N) * doc.loop).blobs[0];
    pts.push(b.x, b.y);
  }
  return pts;
}

function drawOverlay(fr) {
  const ctx = octx;
  const v = state.view;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Artboard outline
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(v.x) - 0.5, Math.round(v.y) - 0.5, Math.round(doc.board.w * v.zoom) + 1, Math.round(doc.board.h * v.zoom) + 1);

  const byId = new Map();
  fr.blobs.forEach((b, i) => byId.set(b.id, { b, src: doc.blobs[i] }));

  // Motion paths of selected animated blobs
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = 'rgba(197,217,47,0.45)';
  for (const id of state.selection) {
    const e = byId.get(id);
    if (!e || e.src.motion.type === 'none') continue;
    const pts = motionPath(e.src);
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 2) {
      const x = pts[i] * v.zoom + v.x, y = pts[i + 1] * v.zoom + v.y;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);

  const ring = (b, color, width) => {
    ctx.beginPath();
    ctx.arc(b.x * v.zoom + v.x, b.y * v.zoom + v.y, Math.max(b.r * v.zoom, 2), 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  };
  const outline = (b, color, width) => { ring(b, 'rgba(0,0,0,0.55)', width + 2); ring(b, color, width); };

  if (state.hover != null && !state.selection.has(state.hover) && !state.drag) {
    const e = byId.get(state.hover);
    if (e) outline(e.b, 'rgba(197,217,47,0.7)', 1);
  }
  for (const id of state.selection) {
    const e = byId.get(id);
    if (!e) continue;
    outline(e.b, '#c5d92f', 1.5);
    const k = knobPos(e.b);
    ctx.beginPath();
    ctx.arc(k.x, k.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#121212';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#c5d92f';
    ctx.stroke();
  }

  const d = state.drag;
  if (d && d.type === 'marquee') {
    const x = Math.min(d.ax, d.bx), y = Math.min(d.ay, d.by);
    const w = Math.abs(d.bx - d.ax), h = Math.abs(d.by - d.ay);
    ctx.fillStyle = 'rgba(197,217,47,0.08)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(197,217,47,0.8)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  }
}

function updateClock() {
  $('#clock').textContent = state.time.toFixed(2) + 's';
  if (!state.scrubbing) $('#scrub').value = String(Math.round((state.time / doc.loop) * 1000));
  const btn = $('#play');
  btn.classList.toggle('playing', state.playing);
  btn.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
}

// ---------------------------------------------------------------- hit testing
function hitBlob(sx, sy) {
  const p = screenToBoard(sx, sy);
  const tol = 3 / state.view.zoom;
  const bl = state.frame.blobs;
  for (let i = bl.length - 1; i >= 0; i--) {
    const b = bl[i];
    if (Math.hypot(p.x - b.x, p.y - b.y) <= b.r + tol) return b.id;
  }
  return null;
}
function hitKnob(sx, sy) {
  for (const b of state.frame.blobs) {
    if (!state.selection.has(b.id)) continue;
    const k = knobPos(b);
    if (Math.hypot(sx - k.x, sy - k.y) <= 9) return b;
  }
  return null;
}
const blobById = (id) => doc.blobs.find((b) => b.id === id);
const selectedBlobs = () => doc.blobs.filter((b) => state.selection.has(b.id));

// ---------------------------------------------------------------- editing ops
function defaultRadius() {
  return state.lastRadius || Math.round(Math.min(doc.board.w, doc.board.h) * 0.085);
}
function addBlob(x, y) {
  if (doc.blobs.length >= LIMITS.maxBlobs) { toast(`Maximum of ${LIMITS.maxBlobs} blobs reached.`, { error: true }); return; }
  const b = makeBlob(nextBlobId(doc), round2(x), round2(y), defaultRadius(), state.lastColor);
  doc.blobs.push(b);
  state.selection = new Set([b.id]);
  commit();
  syncPanel();
  requestRender();
  dismissHint();
}
function addBlobAtCenter() {
  const { w, h } = stageSize();
  const c = screenToBoard(w / 2, h / 2);
  // Nudge so repeated adds don't stack exactly.
  const jitter = (doc.blobs.length % 5) * defaultRadius() * 0.4;
  addBlob(clamp(c.x + jitter, 0, doc.board.w), clamp(c.y - jitter, 0, doc.board.h));
}
function deleteSelection() {
  if (!state.selection.size) return;
  doc.blobs = doc.blobs.filter((b) => !state.selection.has(b.id));
  state.selection.clear();
  commit();
  syncPanel();
  requestRender();
}
function duplicateSelection(offset = true) {
  const sel = selectedBlobs();
  if (!sel.length) return [];
  if (doc.blobs.length + sel.length > LIMITS.maxBlobs) { toast(`Maximum of ${LIMITS.maxBlobs} blobs reached.`, { error: true }); return []; }
  let id = nextBlobId(doc);
  const copies = sel.map((b) => {
    const c = JSON.parse(JSON.stringify(b));
    c.id = id++;
    if (offset) { c.x = round2(c.x + b.r * 0.7); c.y = round2(c.y + b.r * 0.7); }
    return c;
  });
  doc.blobs.push(...copies);
  state.selection = new Set(copies.map((c) => c.id));
  return copies;
}
function bringToFront() {
  const sel = selectedBlobs();
  doc.blobs = doc.blobs.filter((b) => !state.selection.has(b.id)).concat(sel);
  commit();
  requestRender();
}
function setBoardSize(w, h) {
  w = Math.round(clamp(w || doc.board.w, 64, 8192));
  h = Math.round(clamp(h || doc.board.h, 64, 8192));
  const dx = (w - doc.board.w) / 2, dy = (h - doc.board.h) / 2;
  for (const b of doc.blobs) { b.x = round2(b.x + dx); b.y = round2(b.y + dy); }
  doc.board = { w, h };
  commit();
  syncPanel();
  fitView();
}
function loadDoc(d, { fit = true, record = true } = {}) {
  doc = d;
  state.selection.clear();
  state.time = 0;
  state.lastRadius = null;
  if (record) commit();
  syncPanel();
  if (fit) fitView();
  setPlaying(isAnimated(doc));
  requestRender();
}

function setPlaying(on) {
  state.playing = !!on;
  lastTs = 0;
  requestRender();
}

// ---------------------------------------------------------------- pointer input
const pointers = new Map();
let pinch = null;

function localPoint(e) {
  const r = stage.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function setCursor(c) { if (overlay.style.cursor !== c) overlay.style.cursor = c; }

overlay.addEventListener('pointerdown', (e) => {
  if (!doc) return;
  overlay.setPointerCapture(e.pointerId);
  const pt = localPoint(e);
  pointers.set(e.pointerId, pt);

  if (pointers.size === 2) {
    // Two-finger pinch / pan; abandon any single-pointer gesture.
    endDrag(false);
    const [a, b] = [...pointers.values()];
    pinch = {
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      view: { ...state.view },
    };
    return;
  }
  if (pointers.size > 2) return;

  if (e.button === 1 || e.button === 2 || (e.button === 0 && state.spaceDown)) {
    state.spaceUsed = true;
    state.drag = { type: 'pan', sx: pt.x, sy: pt.y, vx: state.view.x, vy: state.view.y };
    setCursor('grabbing');
    e.preventDefault();
    return;
  }
  if (e.button !== 0) return;
  dismissHint();

  const knob = hitKnob(pt.x, pt.y);
  if (knob) {
    const c = { x: knob.x, y: knob.y };
    const p = screenToBoard(pt.x, pt.y);
    state.drag = {
      type: 'resize', c,
      startDist: Math.max(Math.hypot(p.x - c.x, p.y - c.y), 1e-3),
      orig: new Map(selectedBlobs().map((b) => [b.id, b.r])),
      changed: false,
    };
    return;
  }

  const id = hitBlob(pt.x, pt.y);
  if (id != null) {
    if (e.shiftKey) {
      if (state.selection.has(id)) { state.selection.delete(id); syncPanel(); requestRender(); return; }
      state.selection.add(id);
    } else if (!state.selection.has(id)) {
      state.selection = new Set([id]);
    }
    let dup = false;
    if (e.altKey) dup = duplicateSelection(false).length > 0;
    const start = screenToBoard(pt.x, pt.y);
    state.drag = {
      type: 'move', start,
      orig: new Map(selectedBlobs().map((b) => [b.id, { x: b.x, y: b.y }])),
      changed: dup,
    };
    setCursor('grabbing');
    syncPanel();
    requestRender();
    return;
  }

  // Empty space: marquee selection.
  state.drag = {
    type: 'marquee', ax: pt.x, ay: pt.y, bx: pt.x, by: pt.y,
    base: e.shiftKey ? new Set(state.selection) : new Set(),
  };
  if (!e.shiftKey && state.selection.size) { state.selection.clear(); syncPanel(); }
  requestRender();
});

overlay.addEventListener('pointermove', (e) => {
  if (!doc) return;
  const pt = localPoint(e);
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, pt);

  if (pinch && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const z = clamp(pinch.view.zoom * (dist / pinch.dist), 0.02, 16);
    const f = z / pinch.view.zoom;
    state.view.zoom = z;
    state.autoFit = false;
    state.view.x = mid.x - (pinch.mid.x - pinch.view.x) * f;
    state.view.y = mid.y - (pinch.mid.y - pinch.view.y) * f;
    updateZoomLabel();
    requestRender();
    return;
  }

  const d = state.drag;
  if (!d) {
    const knob = hitKnob(pt.x, pt.y);
    const id = knob ? null : hitBlob(pt.x, pt.y);
    if (id !== state.hover) { state.hover = id; requestRender(); }
    setCursor(state.spaceDown ? 'grab' : knob ? 'nwse-resize' : id != null ? 'move' : 'default');
    return;
  }
  if (d.type === 'pan') {
    state.autoFit = false;
    state.view.x = d.vx + (pt.x - d.sx);
    state.view.y = d.vy + (pt.y - d.sy);
    requestRender();
  } else if (d.type === 'move') {
    const p = screenToBoard(pt.x, pt.y);
    let dx = p.x - d.start.x, dy = p.y - d.start.y;
    if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    for (const b of doc.blobs) {
      const o = d.orig.get(b.id);
      if (o) { b.x = o.x + dx; b.y = o.y + dy; }
    }
    d.changed = true;
    requestRender();
  } else if (d.type === 'resize') {
    const p = screenToBoard(pt.x, pt.y);
    const f = Math.hypot(p.x - d.c.x, p.y - d.c.y) / d.startDist;
    for (const b of doc.blobs) {
      const r0 = d.orig.get(b.id);
      if (r0 != null) b.r = clamp(r0 * f, 2, 2000);
    }
    d.changed = true;
    syncSelectionFields();
    requestRender();
  } else if (d.type === 'marquee') {
    d.bx = pt.x; d.by = pt.y;
    const a = screenToBoard(Math.min(d.ax, d.bx), Math.min(d.ay, d.by));
    const b = screenToBoard(Math.max(d.ax, d.bx), Math.max(d.ay, d.by));
    const sel = new Set(d.base);
    for (const bl of state.frame.blobs) {
      // Select blobs whose circle touches the box.
      const cx = clamp(bl.x, a.x, b.x), cy = clamp(bl.y, a.y, b.y);
      if (Math.hypot(bl.x - cx, bl.y - cy) <= bl.r) sel.add(bl.id);
    }
    state.selection = sel;
    syncPanel();
    requestRender();
  }
});

function endDrag(record = true) {
  const d = state.drag;
  state.drag = null;
  if (!d) return;
  if ((d.type === 'move' || d.type === 'resize') && d.changed) {
    for (const b of selectedBlobs()) { b.x = round2(b.x); b.y = round2(b.y); b.r = round2(b.r); }
    if (d.type === 'resize') {
      const first = selectedBlobs()[0];
      if (first) state.lastRadius = first.r;
    }
    if (record) commit();
    syncPanel();
  }
  setCursor(state.spaceDown ? 'grab' : 'default');
  requestRender();
}

function pointerEnd(e) {
  pointers.delete(e.pointerId);
  if (pinch) { if (pointers.size < 2) pinch = null; return; }
  endDrag(true);
}
overlay.addEventListener('pointerup', pointerEnd);
overlay.addEventListener('pointercancel', pointerEnd);
overlay.addEventListener('lostpointercapture', (e) => { if (pointers.has(e.pointerId)) pointerEnd(e); });
overlay.addEventListener('pointerleave', () => { if (!state.drag && state.hover != null) { state.hover = null; requestRender(); } });
overlay.addEventListener('contextmenu', (e) => e.preventDefault());

overlay.addEventListener('dblclick', (e) => {
  const pt = localPoint(e);
  if (hitBlob(pt.x, pt.y) != null || hitKnob(pt.x, pt.y)) return;
  const p = screenToBoard(pt.x, pt.y);
  addBlob(p.x, p.y);
});

overlay.addEventListener('wheel', (e) => {
  e.preventDefault();
  const pt = localPoint(e);
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
  const dy = e.deltaY * unit;
  if (e.ctrlKey || e.metaKey || Math.abs(e.deltaX) < 1e-6) {
    // Pinch gestures arrive as ctrl+wheel with small deltas.
    const k = e.ctrlKey ? 0.01 : 0.0015;
    zoomAt(pt.x, pt.y, Math.exp(-clamp(dy, -400, 400) * k));
  } else {
    state.autoFit = false;
    state.view.x -= e.deltaX * unit;
    state.view.y -= dy;
    requestRender();
  }
}, { passive: false });

// ---------------------------------------------------------------- keyboard
const isTyping = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
  && !(el.type === 'range' || el.type === 'checkbox');

window.addEventListener('keydown', (e) => {
  if (!doc || $('#export-dialog').open) return;
  const mod = e.ctrlKey || e.metaKey;
  const typing = isTyping(document.activeElement);
  if (typing && e.key !== 'Escape') return;
  const k = e.key;

  if (mod && (k === 'z' || k === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (mod && (k === 'y' || k === 'Y')) { e.preventDefault(); redo(); return; }
  if (mod && (k === 'd' || k === 'D')) { e.preventDefault(); if (duplicateSelection().length) { commit(); syncPanel(); requestRender(); } return; }
  if (mod && (k === 'a' || k === 'A')) { e.preventDefault(); state.selection = new Set(doc.blobs.map((b) => b.id)); syncPanel(); requestRender(); return; }
  if (mod && (k === 's' || k === 'S')) { e.preventDefault(); saveJSON(); return; }
  if (mod) return;

  if (k === ' ') {
    e.preventDefault();
    if (!e.repeat) { state.spaceDown = true; state.spaceUsed = false; setCursor('grab'); }
    return;
  }
  if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); deleteSelection(); return; }
  if (k === 'Escape') { if (typing) document.activeElement.blur(); state.selection.clear(); syncPanel(); requestRender(); return; }
  if (k === 'a' || k === 'A' || k === 'n' || k === 'N') { addBlobAtCenter(); return; }
  if (k === 'f' || k === 'F' || k === '0') { fitView(); return; }
  if (k === '+' || k === '=') { const s = stageSize(); zoomAt(s.w / 2, s.h / 2, 1.25); return; }
  if (k === '-' || k === '_') { const s = stageSize(); zoomAt(s.w / 2, s.h / 2, 0.8); return; }
  if (k === 'k' || k === 'K') { setPlaying(!state.playing); return; }
  if ((k === '[' || k === ']') && state.selection.size) {
    const f = k === ']' ? 1.06 : 1 / 1.06;
    for (const b of selectedBlobs()) b.r = round2(clamp(b.r * f, 2, 2000));
    commit(); syncSelectionFields(); requestRender();
    return;
  }
  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (arrows[k] && state.selection.size) {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    for (const b of selectedBlobs()) { b.x = round2(b.x + arrows[k][0] * step); b.y = round2(b.y + arrows[k][1] * step); }
    commit(); requestRender();
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key === ' ') {
    const wasSpace = state.spaceDown;
    state.spaceDown = false;
    setCursor('default');
    if (wasSpace && !state.spaceUsed && !isTyping(document.activeElement)) setPlaying(!state.playing);
  }
});
window.addEventListener('blur', () => { state.spaceDown = false; });

// ---------------------------------------------------------------- panel widgets
function fmt(v, step) {
  const dec = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return Number(v).toFixed(dec);
}

/** Range + number pair bound to getter/setter. */
function slider(row, { label, min, max, step, get, set, numMax }) {
  row.innerHTML = '';
  const l = document.createElement('span');
  l.className = 'lbl';
  l.textContent = label;
  const range = document.createElement('input');
  range.type = 'range';
  Object.assign(range, { min, max, step });
  range.setAttribute('aria-label', label);
  const number = document.createElement('input');
  number.type = 'number';
  Object.assign(number, { min, max: numMax ?? max, step });
  number.setAttribute('aria-label', label);
  row.append(l, range, number);
  const apply = (v, src) => {
    if (!Number.isFinite(v)) return;
    v = clamp(v, min, numMax ?? max);
    set(v);
    if (src !== range) range.value = String(v);
    if (src !== number) number.value = fmt(v, step);
    requestRender();
  };
  range.addEventListener('input', () => apply(parseFloat(range.value), range));
  range.addEventListener('change', () => commit());
  number.addEventListener('input', () => { if (number.value !== '') apply(parseFloat(number.value), number); });
  number.addEventListener('change', () => { apply(parseFloat(number.value), null); commit(); });
  return {
    update() {
      const v = get();
      if (v == null) return;
      if (document.activeElement !== range) range.value = String(v);
      if (document.activeElement !== number) number.value = fmt(v, step);
    },
    row,
  };
}

function swatchPicker(container, { get, set }) {
  container.innerHTML = '';
  const buttons = PALETTE.map((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sw';
    b.style.background = c;
    b.title = c;
    b.setAttribute('aria-label', 'Color ' + c);
    b.addEventListener('click', () => { set(c); commit(); update(); requestRender(); });
    container.appendChild(b);
    return [c, b];
  });
  const custom = document.createElement('label');
  custom.className = 'sw sw-custom';
  custom.title = 'Custom color';
  const input = document.createElement('input');
  input.type = 'color';
  input.setAttribute('aria-label', 'Custom color');
  custom.appendChild(input);
  container.appendChild(custom);
  const hex = document.createElement('input');
  hex.type = 'text';
  hex.className = 'hex';
  hex.maxLength = 7;
  hex.spellcheck = false;
  hex.setAttribute('aria-label', 'Hex color');
  container.appendChild(hex);

  input.addEventListener('input', () => { set(input.value.toLowerCase()); update(true); requestRender(); });
  input.addEventListener('change', () => commit());
  hex.addEventListener('change', () => {
    let v = hex.value.trim().toLowerCase();
    if (!v.startsWith('#')) v = '#' + v;
    if (/^#[0-9a-f]{3}$/.test(v)) v = '#' + [...v.slice(1)].map((c) => c + c).join('');
    if (/^#[0-9a-f]{6}$/.test(v)) { set(v); commit(); requestRender(); }
    update();
  });
  function update(fromPicker) {
    const v = get();
    if (v == null) return;
    for (const [c, b] of buttons) b.classList.toggle('on', c === v);
    custom.classList.toggle('on', !PALETTE.includes(v));
    if (!fromPicker) input.value = v;
    if (document.activeElement !== hex) hex.value = v;
  }
  return { update };
}

// Bridge parameters
const PARAM_LABELS = {
  reach: 'Reach', snap: 'Snap point', thickness: 'Thickness', flare: 'Flare',
  taper: 'Taper', smooth: 'Smoothness', organic: 'Organic',
};
const PARAM_TIPS = {
  reach: 'How far apart blobs can be (× their radius) before the bridge is gone',
  snap: 'Where along the reach the neck pinches off and retracts',
  thickness: 'Neck thickness when blobs are close',
  flare: 'How wide a bridge is where it grows out of a blob',
  taper: 'Higher keeps the neck thin for longer, with a sharper flare',
  smooth: 'Size of the fillets where bridges meet blobs',
  organic: 'Per-bridge bend and asymmetry',
};
const paramWidgets = Object.keys(PARAM_RANGES).map((key) => {
  const [min, max, step] = PARAM_RANGES[key];
  const row = $(`[data-param="${key}"]`);
  row.title = PARAM_TIPS[key];
  return slider(row, {
    label: PARAM_LABELS[key], min, max, step,
    get: () => doc.params[key],
    set: (v) => { doc.params[key] = v; },
  });
});
$('#no-overlap').addEventListener('change', (e) => {
  doc.params.noOverlap = e.target.checked;
  commit(); requestRender();
});
$('#params-reset').addEventListener('click', () => {
  doc.params = { ...DEFAULT_PARAMS, noOverlap: doc.params.noOverlap };
  commit(); syncPanel(); requestRender();
});

// Selection widgets
function forSel(fn) { for (const b of selectedBlobs()) fn(b); }
const firstSel = () => selectedBlobs()[0];

const radiusWidget = slider($('[data-blob="r"]'), {
  label: 'Radius', min: 4, max: 600, step: 1, numMax: 2000,
  get: () => firstSel()?.r,
  set: (v) => { forSel((b) => { b.r = v; }); state.lastRadius = v; },
});
const MOTION_FIELDS = {
  amp: { label: 'Distance', min: 0, max: 600, step: 1, numMax: 2000 },
  cycles: { label: 'Speed', min: 1, max: 8, step: 1, numMax: 12 },
  phase: { label: 'Offset', min: 0, max: 1, step: 0.01 },
  angle: { label: 'Angle', min: -180, max: 180, step: 1 },
  pulse: { label: 'Pulse', min: 0, max: 0.6, step: 0.01 },
};
const MOTION_TIPS = {
  amp: 'How far the blob travels',
  cycles: 'Repeats per loop — whole numbers keep videos seamless',
  phase: 'Shift this blob in time relative to others',
  angle: 'Direction of the swing',
  pulse: 'Breathing: grows and shrinks the radius',
};
const motionWidgets = Object.entries(MOTION_FIELDS).map(([key, cfg]) => {
  const row = $(`[data-motion="${key}"]`);
  row.title = MOTION_TIPS[key];
  const w = slider(row, {
    ...cfg,
    get: () => firstSel()?.motion[key],
    set: (v) => forSel((b) => { b.motion[key] = key === 'cycles' ? Math.round(v) : v; }),
  });
  w.key = key;
  return w;
});

const motionSeg = $('#motion-type');
MOTION_TYPES.forEach((t) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.v = t.id;
  b.textContent = t.label;
  b.setAttribute('role', 'radio');
  b.addEventListener('click', () => {
    forSel((bl) => {
      bl.motion.type = t.id;
      if (t.id === 'orbit' && Math.abs(bl.motion.angle) > 1) bl.motion.angle = 1;
      if (t.id === 'swing' && Math.abs(bl.motion.angle) <= 1) bl.motion.angle = 0;
    });
    commit(); syncPanel(); requestRender();
    if (t.id !== 'none' && !state.playing) setPlaying(true);
  });
  motionSeg.appendChild(b);
});

// Orbit direction (stored as the sign of motion.angle)
const dirRow = document.createElement('div');
dirRow.className = 'row';
dirRow.innerHTML = '<span class="lbl">Direction</span><div class="seg"><button type="button" data-v="1">Clockwise</button><button type="button" data-v="-1">Counter</button></div>';
$('[data-motion="angle"]').after(dirRow);
dirRow.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
  forSel((bl) => { bl.motion.angle = Number(b.dataset.v); });
  commit(); syncPanel(); requestRender();
}));

const blobColor = swatchPicker($('#blob-swatches'), {
  get: () => firstSel()?.color,
  set: (c) => { forSel((b) => { b.color = c; }); state.lastColor = c; },
});

$('#btn-dup').addEventListener('click', () => { if (duplicateSelection().length) { commit(); syncPanel(); requestRender(); } });
$('#btn-del').addEventListener('click', deleteSelection);
$('#btn-front').addEventListener('click', bringToFront);

// Canvas widgets
const boardSelect = $('#board-preset');
for (const p of BOARD_PRESETS) boardSelect.add(new Option(p.label, p.id));
boardSelect.add(new Option('Custom', 'custom'));
boardSelect.addEventListener('change', () => {
  const p = BOARD_PRESETS.find((x) => x.id === boardSelect.value);
  if (p) setBoardSize(p.w, p.h);
});
$('#board-w').addEventListener('change', (e) => setBoardSize(parseFloat(e.target.value), doc.board.h));
$('#board-h').addEventListener('change', (e) => setBoardSize(doc.board.w, parseFloat(e.target.value)));
const bgColor = swatchPicker($('#bg-swatches'), {
  get: () => doc.background,
  set: (c) => { doc.background = c; },
});
$('#transparent').addEventListener('change', (e) => { doc.transparent = e.target.checked; commit(); requestRender(); });
const loopWidget = slider($('[data-doc="loop"]'), {
  label: 'Loop', min: 1, max: 30, step: 0.5, numMax: 60,
  get: () => doc.loop,
  set: (v) => { doc.loop = v; state.time = state.time % v; },
});
$('[data-doc="loop"]').title = 'Length of one seamless animation loop, in seconds';

function syncSelectionFields() {
  radiusWidget.update();
  motionWidgets.forEach((w) => w.update());
}

function syncPanel() {
  if (!doc) return;
  const sel = selectedBlobs();
  const n = sel.length;
  $('#sel-count').textContent = n === 0 ? 'Nothing selected' : n === 1 ? '1 blob' : `${n} blobs`;
  $('#sel-empty').hidden = n > 0;
  $('#sel-body').hidden = n === 0;
  if (n) {
    const m = sel[0].motion;
    motionSeg.querySelectorAll('button').forEach((b) => {
      const on = b.dataset.v === m.type;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
    $('#motion-body').hidden = m.type === 'none';
    $('[data-motion="angle"]').hidden = m.type !== 'swing';
    dirRow.hidden = m.type !== 'orbit';
    dirRow.querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === (m.angle < 0 ? -1 : 1)));
    syncSelectionFields();
    blobColor.update();
  }
  paramWidgets.forEach((w) => w.update());
  $('#no-overlap').checked = !!doc.params.noOverlap;
  loopWidget.update();
  bgColor.update();
  $('#transparent').checked = doc.transparent;
  const bp = BOARD_PRESETS.find((p) => p.w === doc.board.w && p.h === doc.board.h);
  boardSelect.value = bp ? bp.id : 'custom';
  $('#board-w').value = doc.board.w;
  $('#board-h').value = doc.board.h;
}

// ---------------------------------------------------------------- top bar
const presetSelect = $('#preset');
PRESETS.forEach((p, i) => presetSelect.add(new Option(p.name, String(i))));
presetSelect.addEventListener('change', () => {
  const p = PRESETS[Number(presetSelect.value)];
  presetSelect.selectedIndex = 0;
  if (p) loadDoc(normalizeDoc(p.build()));
  presetSelect.blur();
});
$('#undo').addEventListener('click', undo);
$('#redo').addEventListener('click', redo);
$('#play').addEventListener('click', () => {
  setPlaying(!state.playing);
  if (state.playing && !isAnimated(doc)) toast('Nothing moves yet — pick a motion for a blob in the panel.');
});
const scrub = $('#scrub');
scrub.addEventListener('pointerdown', () => { state.scrubbing = true; });
scrub.addEventListener('input', () => {
  state.playing = false;
  state.time = (Number(scrub.value) / 1000) * doc.loop * 0.99999;
  requestRender();
});
const endScrub = () => { state.scrubbing = false; };
scrub.addEventListener('pointerup', endScrub);
scrub.addEventListener('change', endScrub);
$('#btn-add').addEventListener('click', addBlobAtCenter);
$('#zoom-in').addEventListener('click', () => { const s = stageSize(); zoomAt(s.w / 2, s.h / 2, 1.25); });
$('#zoom-out').addEventListener('click', () => { const s = stageSize(); zoomAt(s.w / 2, s.h / 2, 0.8); });
$('#zoom-label').addEventListener('click', fitView);

let hintTimer = 0;
function dismissHint() {
  const h = $('#hint');
  if (h.classList.contains('gone')) return;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => h.classList.add('gone'), 1500);
  try { localStorage.setItem(HINT_KEY, '1'); } catch { /* ignore */ }
}

// ---------------------------------------------------------------- file
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
function saveJSON() {
  download(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }), `blobs-${stamp()}.json`);
}
async function openFile(file) {
  try {
    const text = await file.text();
    loadDoc(normalizeDoc(JSON.parse(text)));
    toast(`Opened ${file.name}`);
  } catch (err) {
    console.error(err);
    toast('That file is not a valid blob composition.', { error: true });
  }
}
$('#btn-new').addEventListener('click', () => {
  const d = emptyDoc();
  d.board = { ...doc.board };
  d.background = doc.background;
  loadDoc(d);
});
$('#btn-open').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', (e) => {
  const f = e.target.files?.[0];
  if (f) openFile(f);
  e.target.value = '';
});
$('#btn-save').addEventListener('click', saveJSON);
$('#btn-link').addEventListener('click', async () => {
  try {
    const code = await encodeDoc(doc);
    const url = `${location.origin}${location.pathname}#d=${code}`;
    await navigator.clipboard.writeText(url);
    toast('Link copied — anyone with it opens this composition.');
  } catch (err) {
    console.error(err);
    toast('Could not copy the link in this browser.', { error: true });
  }
});
stage.addEventListener('dragover', (e) => { e.preventDefault(); });
stage.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (f) openFile(f);
});

// ---------------------------------------------------------------- export dialog
const dlg = $('#export-dialog');
$('#btn-export').addEventListener('click', () => {
  const v = videoSupport();
  $('#do-video').disabled = !v;
  $('#video-note').textContent = v
    ? `Records one seamless ${doc.loop}s loop in real time (${v.includes('mp4') ? 'MP4' : 'WebM'}).`
    : 'Video recording is not supported in this browser.';
  dlg.showModal();
});
$('#png-scale').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  state.pngScale = Number(b.dataset.v);
  $('#png-scale').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
});

function setExportBusy(busy, label = '') {
  const prog = $('#export-progress');
  prog.hidden = !busy;
  dlg.querySelectorAll('.export-item button').forEach((b) => { b.disabled = busy || (b.id === 'do-video' && !videoSupport()); });
  if (busy) setProgress(0, label);
}
function setProgress(p, label) {
  const prog = $('#export-progress');
  prog.querySelector('div').style.setProperty('--p', `${Math.round(p * 100)}%`);
  prog.querySelector('span').textContent = label || `${Math.round(p * 100)}%`;
}

$('#do-png').addEventListener('click', async () => {
  setExportBusy(true, 'Rendering…');
  try {
    const blob = await exportPNG(doc, state.time, state.pngScale);
    download(blob, `blobs-${stamp()}.png`);
    toast('PNG exported.');
  } catch (err) {
    console.error(err);
    toast('PNG export failed: ' + err.message, { error: true });
  } finally { setExportBusy(false); }
});
$('#do-svg').addEventListener('click', async () => {
  setExportBusy(true);
  try {
    const svg = await exportSVG(doc, state.time, { onProgress: (p) => setProgress(p) });
    download(new Blob([svg], { type: 'image/svg+xml' }), `blobs-${stamp()}.svg`);
    toast('SVG exported.');
  } catch (err) {
    console.error(err);
    toast('SVG export failed: ' + err.message, { error: true });
  } finally { setExportBusy(false); }
});
$('#do-video').addEventListener('click', async () => {
  const ac = new AbortController();
  state.exporting = ac;
  setExportBusy(true, 'Recording…');
  try {
    const { blob, ext } = await recordVideo(doc, {
      signal: ac.signal,
      onProgress: (p) => setProgress(p, `${(p * doc.loop).toFixed(1)}s / ${doc.loop}s`),
    });
    download(blob, `blobs-${stamp()}.${ext}`);
    toast('Video exported.');
  } catch (err) {
    if (err.name !== 'AbortError') { console.error(err); toast('Recording failed: ' + (err.message || err), { error: true }); }
  } finally {
    state.exporting = null;
    setExportBusy(false);
  }
});
$('#cancel-export').addEventListener('click', () => state.exporting?.abort());
dlg.addEventListener('close', () => state.exporting?.abort());

// ---------------------------------------------------------------- boot
async function boot() {
  let initial = null;
  const m = location.hash.match(/^#d=(.+)$/);
  if (m) {
    try {
      initial = normalizeDoc(await decodeDoc(m[1]));
      window.history.replaceState(null, '', location.pathname + location.search);
    } catch (err) {
      console.error(err);
      toast('The shared link could not be read.', { error: true });
    }
  }
  if (!initial) {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) initial = normalizeDoc(JSON.parse(saved));
    } catch { /* ignore corrupt storage */ }
  }
  if (!initial) initial = normalizeDoc(PRESETS[0].build());
  try { if (localStorage.getItem(HINT_KEY)) $('#hint').classList.add('gone'); } catch { /* ignore */ }

  resize();
  loadDoc(initial);
  new ResizeObserver(resize).observe(stage);
  window.addEventListener('resize', resize);
}

boot();

// Debug/automation handle.
window.blobs = {
  get doc() { return doc; },
  load: (d) => loadDoc(normalizeDoc(d)),
  setTime: (t) => { state.time = t; requestRender(); },
  play: setPlaying,
};
