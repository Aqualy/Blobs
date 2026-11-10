import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evalField, DEFAULT_PARAMS, computePairs } from '../src/field.js';
import { normalizeDoc, PRESETS, makeBlob, emptyDoc } from '../src/model.js';
import { frameAt, drawnRadius } from '../src/scene.js';
import { easeSeg, samplePos, sampleScalar, setKey, normalizeKeys, KEY_EPS } from '../src/keys.js';

const P = { ...DEFAULT_PARAMS };

test('easing: linear is identity, ease is smoothstep, ends are exact', () => {
  for (const u of [0, 0.1, 0.37, 0.5, 0.9, 1]) {
    assert.ok(Math.abs(easeSeg(u, false, false) - u) < 1e-12);
    assert.ok(Math.abs(easeSeg(u, true, true) - u * u * (3 - 2 * u)) < 1e-12);
  }
  for (const [a, b] of [[true, false], [false, true]]) {
    assert.equal(easeSeg(0, a, b), 0);
    assert.equal(easeSeg(1, a, b), 1);
  }
});

test('tracks pass through their keys and hold outside them', () => {
  const pos = [{ t: 1, x: 0, y: 0, ease: true }, { t: 2, x: 100, y: 50, ease: false }, { t: 4, x: 30, y: 200, ease: true }];
  const r = [{ t: 0.5, v: 0, ease: true }, { t: 3, v: 80, ease: true }];
  for (const curve of [true, false]) {
    for (const k of pos) {
      const p = samplePos(pos, k.t, curve, {});
      assert.ok(Math.hypot(p.x - k.x, p.y - k.y) < 1e-9, `curve=${curve} t=${k.t}`);
    }
    assert.deepEqual(samplePos(pos, 0, curve, {}), { x: 0, y: 0 });
    assert.deepEqual(samplePos(pos, 9, curve, {}), { x: 30, y: 200 });
  }
  assert.equal(sampleScalar(r, 0), 0);
  assert.equal(sampleScalar(r, 3), 80);
  assert.equal(sampleScalar(r, 7), 80);
  assert.ok(Math.abs(sampleScalar(r, 1.75) - 40) < 1e-9);
});

test('route and size are continuous in time', () => {
  const pos = [
    { t: 0, x: 0, y: 0, ease: false }, { t: 1, x: 300, y: 20, ease: false },
    { t: 1.2, x: 310, y: 240, ease: true }, { t: 3, x: -50, y: 100, ease: false },
  ];
  let prev = null, worst = 0;
  for (let t = 0; t <= 3.2; t += 1e-4) {
    const p = samplePos(pos, t, true, {});
    if (prev) worst = Math.max(worst, Math.hypot(p.x - prev.x, p.y - prev.y));
    prev = p;
  }
  // Fastest segment covers ~300 units in 0.2 s: well under 1 unit per 0.1 ms
  // step means no jumps anywhere, including at the keys.
  assert.ok(worst < 1, `largest step ${worst}`);
});

test('setKey updates a key at the same time instead of adding one', () => {
  const track = [];
  setKey(track, 1, { v: 10 });
  setKey(track, 1 + KEY_EPS / 2, { v: 20 });
  setKey(track, 0.5, { v: 5 });
  assert.deepEqual(track.map((k) => [k.t, k.v]), [[0.5, 5], [1, 20]]);
});

test('normalizeKeys sanitizes hostile input', () => {
  const lim = { maxTime: 60, minX: -100, maxX: 200, minY: -100, maxY: 200 };
  const k = normalizeKeys({
    pos: [{ t: 5, x: 1e9, y: 'a' }, { t: 2, x: 1, y: 2 }, null, { t: -3, x: 0, y: 0, ease: false }, { t: 2, x: 9, y: 9 }],
    r: [{ t: 1, v: -50 }, { t: 1e6, v: 1e6 }, { t: NaN, v: 1 }],
    curve: 'no',
  }, lim);
  assert.deepEqual(k.pos, [{ t: 0, x: 0, y: 0, ease: false }, { t: 2, x: 9, y: 9, ease: true }]);
  assert.deepEqual(k.r, [{ t: 1, v: 0, ease: true }, { t: 60, v: 2000, ease: true }]);
  assert.equal(k.curve, true);
  assert.deepEqual(normalizeKeys(undefined, lim), { pos: [], r: [], curve: true });
  // Old documents without keys load with empty tracks.
  const d = normalizeDoc({ blobs: [{ id: 1, x: 10, y: 10, r: 20 }] });
  assert.deepEqual(d.blobs[0].keys, { pos: [], r: [], curve: true });
});

test('a blob of size 0 is not drawn and leaves no bridge', () => {
  const d = emptyDoc();
  d.blobs = [
    makeBlob(1, 300, 300, 80),
    makeBlob(2, 420, 300, 50, undefined, null, { r: [{ t: 0, v: 0, ease: true }, { t: 1, v: 50, ease: true }] }),
  ];
  const f0 = frameAt(d, 0);
  assert.equal(f0.blobs.length, 1);
  assert.equal(f0.all.length, 2);
  assert.equal(f0.pairs.length, 0);
  const f1 = frameAt(d, 1);
  assert.equal(f1.blobs.length, 2);
  assert.equal(f1.pairs.length, 1);
});

// Field over a grid, limited to the band that can ever be visible: inside,
// up to the 2.5-unit margin where bridge remains are pushed (field.js `kill`).
function sample(fr, x0, y0, x1, y1, step) {
  const out = [];
  for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) {
    out.push(Math.max(-4, Math.min(2.4, evalField(x, y, fr.blobs, fr.pairs, P))));
  }
  return out;
}

test('a blob growing out of nothing next to another never pops', () => {
  for (const dist of [90, 140, 220]) {
    let prev = null, worst = 0;
    for (let r = 0; r <= 16; r += 0.05) {
      const blobs = [{ id: 1, x: 200, y: 200, r: 60 }];
      if (r > 0) blobs.push({ id: 2, x: 200 + dist, y: 200, r: drawnRadius(r), grow: true });
      const s = sample({ blobs, pairs: computePairs(blobs, P) }, 200, 160, 200 + dist + 20, 240, 2);
      if (prev) for (let i = 0; i < s.length; i++) worst = Math.max(worst, Math.abs(s[i] - prev[i]));
      prev = s;
    }
    // drawnRadius moves 0.25 units per step below VANISH_R; nothing may jump more than that by much.
    assert.ok(worst < 0.5, `dist ${dist}: max field jump per step ${worst.toFixed(3)}`);
  }
});

test('the keyframe preset plays without pops', () => {
  const doc = normalizeDoc(PRESETS.find((p) => p.name.startsWith('Appear')).build());
  const dt = 1 / 480;
  let prev = null, prevFr = null, worst = 0;
  for (let t = 0; t <= 3.2; t += dt) {
    const fr = frameAt(doc, t);
    const s = sample(fr, 0, 0, 1080, 1080, 18);
    if (prev) {
      // Allowed change: a few times the largest movement or growth of any blob this step.
      let motion = 0;
      fr.all.forEach((b, i) => {
        const a = prevFr.all[i];
        motion = Math.max(motion, Math.hypot(b.x - a.x, b.y - a.y), Math.abs(b.r - a.r));
      });
      let jump = 0;
      for (let i = 0; i < s.length; i++) jump = Math.max(jump, Math.abs(s[i] - prev[i]));
      worst = Math.max(worst, jump / Math.max(motion, 0.05));
    }
    prev = s;
    prevFr = fr;
  }
  assert.ok(worst < 6, `field moved ${worst.toFixed(2)}× faster than the blobs`);
});
