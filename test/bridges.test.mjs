import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePairs, evalField, bridgeDist, DEFAULT_PARAMS, BRIDGE_RANGES } from '../src/field.js';
import { normalizeDoc } from '../src/model.js';

const P = { ...DEFAULT_PARAMS };
const edits = (list) => new Map(list.map((e) => [`${e.a}-${e.b}`, e]));

function pair(gap, r1 = 60, r2 = 45) {
  const d = r1 + r2 + gap;
  return [{ id: 1, x: 300 - d / 2, y: 200, r: r1 }, { id: 2, x: 300 + d / 2, y: 200, r: r2 }];
}

function grid(blobs, ed, step = 6) {
  const pairs = computePairs(blobs, P, ed);
  const out = [];
  for (let y = 40; y <= 360; y += step) for (let x = 0; x <= 600; x += step) {
    out.push(Math.max(-4, Math.min(4, evalField(x, y, blobs, pairs, P))));
  }
  return out;
}

test('an edit at its defaults changes nothing', () => {
  const blobs = pair(60);
  const a = computePairs(blobs, P);
  const b = computePairs(blobs, P, edits([{ a: 1, b: 2, c0: 0, c1: 0, neck: null, thick: 1, flare: 1, off: false }]));
  assert.deepEqual(a, b);
});

test('handles bend the bridge: its curve stays inside, the old straight line clears', () => {
  const blobs = pair(160);
  const [q] = computePairs(blobs, P, edits([{ a: 1, b: 2, c0: 0.6, c1: 0.6 }]));
  const L = Math.hypot(q.x1 - q.x0, q.y1 - q.y0);
  // Midpoint of the curve: 3/4 · 0.6 · L to the left of the A→B direction (+y here).
  const mx = (q.x0 + q.x1) / 2, my = (q.y0 + q.y1) / 2;
  const side = q.bend * L + 0.75 * 0.6 * L;
  assert.ok(bridgeDist(mx, my + side, q, null) < 0, 'curve midpoint is inside');
  assert.ok(bridgeDist(mx, my, q, null) > 5, 'the straight line is now outside');
});

test('thickness and flare scale the bridge', () => {
  const blobs = pair(100);
  const [base] = computePairs(blobs, P);
  const [thick] = computePairs(blobs, P, edits([{ a: 1, b: 2, thick: 2, flare: 1.5 }]));
  assert.ok(Math.abs(thick.wMid - base.wMid * 2) < 1e-9);
  assert.ok(thick.w0 > base.w0 * 1.4 && thick.w1 > base.w1 * 1.4);
});

test('a hidden bridge is gone', () => {
  const blobs = pair(40);
  assert.equal(computePairs(blobs, P, edits([{ a: 1, b: 2, off: true }])).length, 0);
});

test('the bounding circle holds the whole curved bridge (exact culling)', () => {
  // Shader and tile culling skip a bridge when |p − c| − bound > d + k, which is
  // only safe if bridgeDist(p) ≥ |p − c| − bound everywhere.
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const [lo, hi] = BRIDGE_RANGES.c;
  let checked = 0;
  for (let n = 0; n < 60; n++) {
    const blobs = pair(rnd() * 200, 30 + rnd() * 90, 30 + rnd() * 90);
    const ed = { a: 1, b: 2, c0: lo + rnd() * (hi - lo), c1: lo + rnd() * (hi - lo), thick: 0.1 + rnd() * 3.9, flare: 0.2 + rnd() * 2.3, neck: 0.12 + rnd() * 0.76 };
    const [q] = computePairs(blobs, P, edits([ed]));
    if (!q) continue;
    for (let y = -400; y <= 800; y += 9) for (let x = -300; x <= 900; x += 9) {
      const lower = Math.hypot(x - q.cx, y - q.cy) - q.bound;
      assert.ok(bridgeDist(x, y, q, null) >= lower - 1e-6, `edit ${JSON.stringify(ed)} at ${x},${y}`);
      checked++;
    }
  }
  assert.ok(checked > 100000);
});

test('a wide, flaring curved bridge is a true distance: no folds or spikes', () => {
  // The user's composition at Flare 0.44 grew spikes: the curve was an offset
  // of the straight bridge, which folds once a bridge is wider than its bend.
  // A true distance never changes faster than the point moves (1-Lipschitz).
  const p = { ...P, flare: 0.7, taper: 1.2, thickness: 1, smooth: 0.77 };
  const blobs = [{ id: 1, x: 450, y: 330, r: 135 }, { id: 3, x: 260, y: 860, r: 141 }];
  for (const [c0, c1] of [[0.85, 0.36], [-1.2, 1.2], [1.2, 1.2], [0.4, -0.9]]) {
    const [q] = computePairs(blobs, p, edits([{ a: 1, b: 3, c0, c1, flare: 2.5 }]));
    let worst = 0;
    const h = 0.5;
    for (let y = 250; y <= 950; y += 7) for (let x = 0; x <= 700; x += 7) {
      const d = bridgeDist(x, y, q, null);
      if (d > 40) continue;
      worst = Math.max(worst, Math.abs(bridgeDist(x + h, y, q, null) - d) / h, Math.abs(bridgeDist(x, y + h, q, null) - d) / h);
    }
    assert.ok(worst <= 1 + 1e-6, `c0=${c0} c1=${c1}: field changes ${worst.toFixed(3)}× faster than distance`);
  }
});

test('a shaped bridge stays continuous while its blobs separate', () => {
  const ed = edits([{ a: 1, b: 2, c0: 0.8, c1: -0.6, thick: 2, flare: 1.6, neck: 0.3 }]);
  const reach = P.reach * (60 + 45) / 2;
  let prev = null, worst = 0;
  for (let gap = -40; gap <= reach + 20; gap += 0.25) {
    const s = grid(pair(gap), ed);
    if (prev) for (let i = 0; i < s.length; i++) worst = Math.max(worst, Math.abs(s[i] - prev[i]));
    prev = s;
  }
  // Blobs move 0.125 units per step each; curved stretches amplify that a little.
  assert.ok(worst < 1.2, `max field jump per step ${worst.toFixed(3)}`);
});

test('dragging a handle changes the shape smoothly', () => {
  const blobs = pair(120);
  let prev = null, worst = 0;
  for (let c = BRIDGE_RANGES.c[0]; c <= BRIDGE_RANGES.c[1]; c += 0.005) {
    const s = grid(blobs, edits([{ a: 1, b: 2, c0: c, c1: -c * 0.5 }]));
    if (prev) for (let i = 0; i < s.length; i++) worst = Math.max(worst, Math.abs(s[i] - prev[i]));
    prev = s;
  }
  // 0.005 × L (≈ 170) ≈ 0.85 units of handle travel per step.
  assert.ok(worst < 3, `max field jump per step ${worst.toFixed(3)}`);
});

test('normalizeDoc sanitizes bridge edits', () => {
  const d = normalizeDoc({
    blobs: [{ id: 1, x: 0, y: 0, r: 50 }, { id: 2, x: 200, y: 0, r: 50 }, { id: 3, x: 0, y: 200, r: 50 }],
    bridges: [
      { a: 2, b: 1, c0: 0.5, c1: -0.2, neck: 0.3, thick: 99 }, // given the other way round
      { a: 1, b: 2, c0: 0.9 },                                  // duplicate: dropped
      { a: 1, b: 9, thick: 2 },                                 // unknown blob
      { a: 1, b: 3 },                                           // all defaults
      { a: 3, b: 3, thick: 2 },                                 // same blob
      { a: 1, b: 3, flare: 'x', off: true },
      null,
    ],
  });
  assert.deepEqual(d.bridges, [
    { a: 1, b: 2, c0: 0.2, c1: -0.5, neck: 0.7, thick: 4, flare: 1, off: false },
    { a: 1, b: 3, c0: 0, c1: 0, neck: null, thick: 1, flare: 1, off: true },
  ]);
  assert.deepEqual(normalizeDoc({ blobs: [] }).bridges, []);
});
