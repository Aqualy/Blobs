import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePairs, evalField, DEFAULT_PARAMS } from '../src/field.js';
import { normalizeDoc, PRESETS, resolveBlob } from '../src/model.js';
import { marchingSquares } from '../src/contour.js';
import { exportSVG } from '../src/export.js';

const P = { ...DEFAULT_PARAMS };

function sampleGrid(blobs, x0, y0, x1, y1, step, p = P) {
  const pairs = computePairs(blobs, p);
  const out = [];
  for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) out.push(evalField(x, y, blobs, pairs, p));
  return out;
}

// Only the band near the surface is ever visible (coverage + anti-aliasing).
function visible(arr) { return arr.map((d) => Math.max(-4, Math.min(4, d))); }

function separation(gap, r1 = 60, r2 = 45) {
  const d = r1 + r2 + gap;
  return [{ id: 1, x: 300 - d / 2, y: 200, r: r1 }, { id: 2, x: 300 + d / 2, y: 200, r: r2 }];
}

test('field is continuous while blobs separate (no pops at merge, pinch or reach)', () => {
  const reach = P.reach * (60 + 45) / 2;
  const step = 0.25;
  let prev = null;
  let worst = 0;
  for (let gap = -40; gap <= reach + 20; gap += step) {
    const s = visible(sampleGrid(separation(gap), 0, 100, 600, 300, 6));
    if (prev) for (let i = 0; i < s.length; i++) worst = Math.max(worst, Math.abs(s[i] - prev[i]));
    prev = s;
  }
  // Blobs move by step/2 each; a pop would show up as a jump of many units.
  assert.ok(worst < step * 3, `max field jump per step was ${worst.toFixed(3)}`);
});

test('field is continuous while a blob grows', () => {
  let prev = null;
  let worst = 0;
  for (let r = 20; r <= 120; r += 0.25) {
    const blobs = [{ id: 1, x: 150, y: 200, r: 60 }, { id: 2, x: 420, y: 200, r }];
    const s = visible(sampleGrid(blobs, 0, 100, 600, 300, 6));
    if (prev) for (let i = 0; i < s.length; i++) worst = Math.max(worst, Math.abs(s[i] - prev[i]));
    prev = s;
  }
  assert.ok(worst < 1.5, `max field jump per step was ${worst.toFixed(3)}`);
});

test('a bridge about to leave reach leaves no visible residue', () => {
  const reach = P.reach * (60 + 45) / 2;
  const blobs = separation(reach - 0.01);
  assert.equal(computePairs(blobs, P).length, 1);
  const withBridge = sampleGrid(blobs, 0, 100, 600, 300, 1);
  const without = sampleGrid(blobs, 0, 100, 600, 300, 1, { ...P, reach: 0.0001 });
  for (let i = 0; i < withBridge.length; i++) {
    // Same inside/outside classification, and never within ~2 units of a new edge.
    assert.equal(withBridge[i] < 0, without[i] < 0);
    if (without[i] > 2.5) assert.ok(withBridge[i] > 2, 'residue near the old bridge');
  }
});

test('close blobs are connected through the bridge', () => {
  const blobs = separation(60);
  const pairs = computePairs(blobs, P);
  // Midpoint of the gap is inside the shape.
  const mx = (blobs[0].x + blobs[0].r + blobs[1].x - blobs[1].r) / 2;
  assert.ok(evalField(mx, 200, blobs, pairs, P) < 0);
});

test('bridge traits do not depend on blob order (beyond smooth-min ordering)', () => {
  const a = separation(50);
  const b = [a[1], a[0]];
  const sa = visible(sampleGrid(a, 0, 100, 600, 300, 10));
  const sb = visible(sampleGrid(b, 0, 100, 600, 300, 10));
  for (let i = 0; i < sa.length; i++) assert.ok(Math.abs(sa[i] - sb[i]) < 0.5);
});

test('normalizeDoc sanitizes hostile input', () => {
  const d = normalizeDoc({
    board: { w: 'x', h: 1e9 }, background: 'red', loop: -5,
    params: { reach: 999, taper: NaN },
    blobs: [{ id: 3, x: 1, y: 2, r: -1, color: '#ABCDEF', motion: { type: 'teleport', cycles: 2.6 } }, null, { id: 3 }],
  });
  assert.equal(d.board.w, 1080);
  assert.equal(d.board.h, 8192);
  assert.equal(d.background, '#1a1a1a');
  assert.equal(d.loop, 1);
  assert.equal(d.params.reach, 8);
  assert.equal(d.params.taper, DEFAULT_PARAMS.taper);
  assert.equal(d.blobs.length, 2);
  assert.equal(d.blobs[0].r, 2);
  assert.equal(d.blobs[0].color, '#abcdef');
  assert.equal(d.blobs[0].motion.type, 'none');
  assert.equal(d.blobs[0].motion.cycles, 3);
  assert.notEqual(d.blobs[0].id, d.blobs[1].id);
  assert.throws(() => normalizeDoc(null));
});

test('every motion loops seamlessly', () => {
  for (const preset of PRESETS) {
    const doc = normalizeDoc(preset.build());
    for (const b of doc.blobs) {
      const a = resolveBlob(b, 0, doc.loop, {});
      const z = resolveBlob(b, doc.loop, doc.loop, {});
      assert.ok(Math.abs(a.x - z.x) < 1e-6 && Math.abs(a.y - z.y) < 1e-6 && Math.abs(a.r - z.r) < 1e-6, preset.name);
    }
  }
});

test('marching squares traces a circle accurately', () => {
  const n = 101, f = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) f[j * n + i] = Math.hypot(i - 50, j - 50) - 30;
  const loops = marchingSquares(f, n, n);
  assert.equal(loops.length, 1);
  const L = loops[0];
  let area = 0;
  for (let k = 0; k < L.length; k += 2) {
    const k2 = (k + 2) % L.length;
    area += L[k] * L[k2 + 1] - L[k2] * L[k + 1];
  }
  area = Math.abs(area) / 2;
  assert.ok(Math.abs(area - Math.PI * 900) / (Math.PI * 900) < 0.005, `area ${area}`);
});

test('SVG export of the Triad preset is one ring (outline + hole)', async () => {
  const doc = normalizeDoc(PRESETS[0].build());
  const svg = await exportSVG(doc, 0);
  assert.match(svg, /^<\?xml/);
  const paths = svg.match(/<path /g) || [];
  assert.equal(paths.length, 1);
  const subpaths = (svg.match(/M/g) || []).length;
  assert.equal(subpaths, 2);
});

test('no-overlap: crossing diagonals of a square give way', () => {
  // Four blobs on a square: edge bridges are stronger than the diagonals.
  const s = 200;
  const blobs = [
    { id: 1, x: 200, y: 200, r: 60 }, { id: 2, x: 200 + s, y: 200, r: 60 },
    { id: 3, x: 200 + s, y: 200 + s, r: 60 }, { id: 4, x: 200, y: 200 + s, r: 60 },
  ];
  const cx = 200 + s / 2, cy = 200 + s / 2;
  const on = { ...P, noOverlap: true };
  assert.ok(evalField(cx, cy, blobs, computePairs(blobs, P), P) < 0, 'diagonals cross when allowed');
  assert.ok(evalField(cx, cy, blobs, computePairs(blobs, on), on) > 2, 'centre stays clear in no-overlap mode');
  // All four edge bridges survive at full strength.
  const kept = computePairs(blobs, on).filter((q) => q.wMid > 5);
  assert.equal(kept.length, 4);
});

test('no-overlap: a bridge does not run through a third blob', () => {
  const blobs = [{ id: 1, x: 100, y: 200, r: 50 }, { id: 2, x: 420, y: 200, r: 50 }, { id: 3, x: 260, y: 200, r: 40 }];
  const on = { ...P, noOverlap: true };
  const pairs = computePairs(blobs, on);
  // The direct 1-2 bridge is gone; 1-3 and 3-2 remain.
  const ids = pairs.map((q) => [blobs[q.ia].id, blobs[q.ib].id].sort().join('-'));
  assert.ok(!ids.includes('1-2'), ids.join(','));
  assert.ok(ids.includes('1-3') && ids.includes('2-3'), ids.join(','));
});

test('no-overlap: shape stays continuous while a blob sweeps through a bridge', () => {
  const on = { ...P, noOverlap: true };
  let prev = null;
  let worst = 0;
  for (let y = 40; y <= 360; y += 0.5) {
    const blobs = [{ id: 1, x: 120, y: 200, r: 55 }, { id: 2, x: 480, y: 200, r: 55 }, { id: 3, x: 300, y, r: 35 },
      { id: 4, x: 300, y: 400 - y * 0.5, r: 30 }];
    const s = visible(sampleGrid(blobs, 0, 0, 600, 400, 6, on));
    if (prev) for (let i = 0; i < s.length; i++) worst = Math.max(worst, Math.abs(s[i] - prev[i]));
    prev = s;
  }
  assert.ok(worst < 2.5, `max field jump per step was ${worst.toFixed(3)}`);
});

test('no-overlap: removes only the crossing bridges, keeps every other bridge intact', () => {
  // Regression: a user composition where the switch used to strip outer edges too.
  const z = 0.65;
  const raw = [[78, 265, 70], [128, 598, 70], [375, 168, 52], [548, 482, 80], [600, -10, 55]];
  const blobs = raw.map(([x, y, r], i) => ({ id: i + 1, x: x / z, y: y / z, r: r / z }));
  const key = (q) => `${blobs[q.ia].id}-${blobs[q.ib].id}`;
  let checked = 0;
  for (const reach of [4.5, 5.5, 6.5, 7.5, 8]) for (const thickness of [0.4, 0.6, 0.8]) for (const smooth of [0.5, 0.8, 1.1]) {
    const p = { ...P, reach, thickness, smooth };
    const off = new Map(computePairs(blobs, p).map((q) => [key(q), q.wMid]));
    const on = new Map(computePairs(blobs, { ...p, noOverlap: true }).map((q) => [key(q), q.wMid]));
    for (const e of ['1-2', '1-3', '2-4', '3-4']) {
      if ((off.get(e) ?? -1) > 2) assert.ok((on.get(e) ?? -99) > off.get(e) * 0.8, `${e} weakened at ${JSON.stringify(p)}`);
    }
    if ((off.get('1-4') ?? -1) > 0 && (off.get('2-3') ?? -1) > 0) {
      checked++;
      for (const e of ['1-4', '2-3']) assert.ok(!((on.get(e) ?? -99) > 0), `crossing ${e} kept at ${JSON.stringify(p)}`);
    }
  }
  assert.ok(checked > 0, 'scenario never produced a visible crossing');
});

test('max bridges: no blob keeps more than its cap', () => {
  const hub = { id: 1, x: 400, y: 400, r: 60 };
  const ring = [140, 160, 180, 200, 220].map((d, i) => {
    const a = (i / 5) * Math.PI * 2;
    return { id: i + 2, x: 400 + Math.cos(a) * d, y: 400 + Math.sin(a) * d, r: 30 };
  });
  const blobs = [hub, ...ring];
  const p = { ...P, reach: 6 };
  const degrees = (q) => {
    const deg = new Array(blobs.length).fill(0);
    for (const b of computePairs(blobs, q)) if (b.wMid > 1) { deg[b.ia]++; deg[b.ib]++; }
    return deg;
  };
  assert.equal(degrees(p)[0], 5);
  for (const cap of [1, 2, 3]) {
    const deg = degrees({ ...p, maxBridges: cap });
    assert.ok(deg.every((d) => d <= cap), `cap ${cap}: ${deg}`);
    assert.ok(deg[0] >= 1, `cap ${cap}: hub lost every bridge`);
  }
});

test('max bridges: shape stays continuous while neighbours swap rank', () => {
  for (const noOverlap of [false, true]) {
    const p = { ...P, maxBridges: 1, noOverlap };
    let prev = null;
    let worst = 0;
    for (let x = 180; x <= 420; x += 0.5) {
      const blobs = [{ id: 1, x, y: 200, r: 45 }, { id: 2, x: 120, y: 200, r: 50 }, { id: 3, x: 480, y: 200, r: 50 },
        { id: 4, x: 300, y: 330, r: 35 }];
      const s = visible(sampleGrid(blobs, 0, 0, 600, 400, 6, p));
      if (prev) for (let i = 0; i < s.length; i++) worst = Math.max(worst, Math.abs(s[i] - prev[i]));
      prev = s;
    }
    assert.ok(worst < 2, `max field jump per step was ${worst.toFixed(3)} (noOverlap ${noOverlap})`);
  }
});

test('max bridges at the top of the range changes nothing', () => {
  for (const pr of PRESETS) {
    const doc = normalizeDoc(pr.build());
    const blobs = doc.blobs.map((b) => resolveBlob(b, 0, doc.loop, {}));
    const a = computePairs(blobs, { ...doc.params });
    const b = computePairs(blobs, { ...doc.params, maxBridges: undefined });
    assert.deepEqual(a, b);
  }
});
