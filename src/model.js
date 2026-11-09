// Document model: schema, validation, motion and presets.
import { DEFAULT_PARAMS, PARAM_RANGES, LIMITS, hash3 } from './field.js';

export const PALETTE = ['#c5d92f', '#dddddd', '#111111', '#ffffff', '#8a9a1f', '#6b6b6b'];

export const BOARD_PRESETS = [
  { id: 'square', label: 'Square 1080 × 1080', w: 1080, h: 1080 },
  { id: 'portrait', label: 'Portrait 1080 × 1350', w: 1080, h: 1350 },
  { id: 'story', label: 'Story 1080 × 1920', w: 1080, h: 1920 },
  { id: 'landscape', label: 'Landscape 1920 × 1080', w: 1920, h: 1080 },
  { id: 'banner', label: 'Banner 1500 × 500', w: 1500, h: 500 },
];

export const MOTION_TYPES = [
  { id: 'none', label: 'Static' },
  { id: 'drift', label: 'Drift' },
  { id: 'orbit', label: 'Orbit' },
  { id: 'swing', label: 'Swing' },
];

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const isHex = (s) => typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s);

export function defaultMotion() {
  return { type: 'none', amp: 60, cycles: 1, phase: 0, angle: 0, pulse: 0 };
}

export function makeBlob(id, x, y, r, color = PALETTE[0], motion) {
  return { id, x, y, r, color, motion: { ...defaultMotion(), ...(motion || {}) } };
}

export function emptyDoc() {
  return {
    version: 1,
    board: { w: 1080, h: 1080 },
    background: '#1a1a1a',
    transparent: false,
    loop: 8,
    params: { ...DEFAULT_PARAMS },
    blobs: [],
  };
}

/** Sanitize any parsed JSON into a valid document (never throws on bad fields). */
export function normalizeDoc(raw) {
  const base = emptyDoc();
  if (!raw || typeof raw !== 'object') throw new Error('Not a blob composition.');
  const doc = base;
  if (raw.board) {
    doc.board.w = Math.round(clamp(num(raw.board.w, 1080), 64, 8192));
    doc.board.h = Math.round(clamp(num(raw.board.h, 1080), 64, 8192));
  }
  if (isHex(raw.background)) doc.background = raw.background.toLowerCase();
  doc.transparent = !!raw.transparent;
  doc.loop = clamp(num(raw.loop, 8), 1, 60);
  if (raw.params && typeof raw.params === 'object') {
    for (const k of Object.keys(DEFAULT_PARAMS)) {
      const [lo, hi] = PARAM_RANGES[k];
      doc.params[k] = clamp(num(raw.params[k], DEFAULT_PARAMS[k]), lo, hi);
    }
  }
  const seen = new Set();
  let nextId = 1;
  const blobs = Array.isArray(raw.blobs) ? raw.blobs.slice(0, LIMITS.maxBlobs) : [];
  for (const b of blobs) {
    if (!b || typeof b !== 'object') continue;
    let id = Math.round(num(b.id, 0));
    if (id <= 0 || seen.has(id)) id = 0;
    const m = b.motion && typeof b.motion === 'object' ? b.motion : {};
    const type = MOTION_TYPES.some((t) => t.id === m.type) ? m.type : 'none';
    doc.blobs.push({
      id,
      x: clamp(num(b.x, doc.board.w / 2), -doc.board.w, doc.board.w * 2),
      y: clamp(num(b.y, doc.board.h / 2), -doc.board.h, doc.board.h * 2),
      r: clamp(num(b.r, 80), 2, 2000),
      color: isHex(b.color) ? b.color.toLowerCase() : PALETTE[0],
      motion: {
        type,
        amp: clamp(num(m.amp, 60), 0, 2000),
        cycles: Math.round(clamp(num(m.cycles, 1), 1, 12)),
        phase: clamp(num(m.phase, 0), 0, 1),
        angle: clamp(num(m.angle, 0), -360, 360),
        pulse: clamp(num(m.pulse, 0), 0, 0.6),
      },
    });
    if (id) seen.add(id);
  }
  for (const b of doc.blobs) if (b.id) nextId = Math.max(nextId, b.id + 1);
  for (const b of doc.blobs) if (!b.id) b.id = nextId++;
  return doc;
}

export function nextBlobId(doc) {
  let m = 0;
  for (const b of doc.blobs) m = Math.max(m, b.id);
  return m + 1;
}

const TAU = Math.PI * 2;

/**
 * Resolve a blob at time `time` (seconds). Every motion is periodic in
 * doc.loop, so recorded videos loop seamlessly.
 */
export function resolveBlob(b, time, loop, out) {
  const m = b.motion;
  const ph = (time / loop) * m.cycles + m.phase;
  const a = ph * TAU;
  let x = b.x, y = b.y;
  switch (m.type) {
    case 'drift': {
      // Two incommensurate-looking but loop-periodic harmonics per axis.
      const s1 = hash3(b.id, 7, 1) * Math.PI, s2 = hash3(b.id, 7, 2) * Math.PI;
      const s3 = hash3(b.id, 7, 3) * Math.PI, s4 = hash3(b.id, 7, 4) * Math.PI;
      x += m.amp * (0.65 * Math.sin(a + s1) + 0.35 * Math.sin(2 * a + s2));
      y += m.amp * (0.65 * Math.cos(a + s3) + 0.35 * Math.sin(3 * a + s4)) * 0.85;
      break;
    }
    case 'orbit': {
      const dir = m.angle < 0 ? -1 : 1;
      x += m.amp * Math.cos(dir * a);
      y += m.amp * Math.sin(dir * a);
      break;
    }
    case 'swing': {
      const ang = (m.angle * Math.PI) / 180;
      const s = Math.sin(a);
      x += m.amp * s * Math.cos(ang);
      y += m.amp * s * Math.sin(ang);
      break;
    }
    default: break;
  }
  let r = b.r;
  if (m.pulse > 0) r *= 1 + m.pulse * Math.sin(a + 1.3);
  out.id = b.id; out.x = x; out.y = y; out.r = r;
  return out;
}

export const isAnimated = (doc) => doc.blobs.some((b) => b.motion.type !== 'none' || b.motion.pulse > 0);

// ---------- presets ----------

function preset(name, build) { return { name, build }; }

export const PRESETS = [
  preset('Triad', () => {
    const d = emptyDoc();
    d.background = '#dddddd';
    const c = '#111111';
    d.blobs = [
      makeBlob(1, 495, 240, 135, c, { type: 'drift', amp: 14, cycles: 1 }),
      makeBlob(2, 828, 588, 126, c, { type: 'drift', amp: 14, cycles: 1 }),
      makeBlob(3, 270, 735, 141, c, { type: 'drift', amp: 14, cycles: 1 }),
    ];
    return d;
  }),
  preset('Lime orbit', () => {
    const d = emptyDoc();
    d.background = '#1a1a1a';
    d.params.reach = 2.6;
    const L = '#c5d92f', G = '#dddddd';
    d.blobs = [
      makeBlob(1, 540, 540, 130, L, { pulse: 0.06, cycles: 2 }),
      makeBlob(2, 660, 540, 64, G, { type: 'orbit', amp: 300, cycles: 1 }),
      makeBlob(3, 440, 600, 50, L, { type: 'orbit', amp: 330, cycles: 2, phase: 0.4, angle: -1 }),
      makeBlob(4, 540, 420, 40, G, { type: 'orbit', amp: 250, cycles: 3, phase: 0.7 }),
    ];
    return d;
  }),
  preset('Chain', () => {
    const d = emptyDoc();
    d.background = '#dddddd';
    d.blobs = [];
    for (let i = 0; i < 6; i++) {
      d.blobs.push(makeBlob(i + 1, 140 + i * 160, 540, i % 2 ? 58 : 72, i % 2 ? '#111111' : '#c5d92f',
        { type: 'swing', amp: 200, cycles: 1, phase: i / 6, angle: 90 }));
    }
    return d;
  }),
  preset('Cluster', () => {
    const d = emptyDoc();
    d.background = '#111111';
    const pts = [
      [540, 520, 120], [330, 360, 70], [760, 330, 82], [300, 720, 90], [770, 760, 66],
      [540, 860, 46], [180, 520, 40], [900, 540, 52], [540, 190, 54],
    ];
    d.blobs = pts.map(([x, y, r], i) => makeBlob(i + 1, x, y, r, i % 3 === 2 ? '#dddddd' : '#c5d92f',
      { type: 'drift', amp: 70, cycles: 1 + (i % 2) }));
    return d;
  }),
  preset('Pulse ring', () => {
    const d = emptyDoc();
    d.background = '#1a1a1a';
    d.blobs = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      d.blobs.push(makeBlob(i + 1, 540 + Math.cos(a) * 300, 540 + Math.sin(a) * 300, 64,
        i % 2 ? '#dddddd' : '#c5d92f', { pulse: 0.35, cycles: 1, phase: i / 8 }));
    }
    return d;
  }),
  preset('Blank', () => emptyDoc()),
];
