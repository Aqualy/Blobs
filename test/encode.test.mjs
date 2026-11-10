import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { crc32 } from '../src/encode/bytes.js';
import { lzwEncode, buildPalette, GIFEncoder } from '../src/encode/gif.js';
import { encodePNG, APNGEncoder } from '../src/encode/png.js';
import { ZipWriter } from '../src/encode/zip.js';
import { WebMMuxer } from '../src/encode/webm.js';
import { MP4Muxer } from '../src/encode/mp4.js';

const bytes = async (blob) => new Uint8Array(await blob.arrayBuffer());

function rand(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Reference GIF LZW decoder (spec behaviour, incl. deferred clear at 4096). */
function lzwDecode(data) {
  let p = 0;
  const min = data[p++];
  const sub = [];
  while (data[p]) { const n = data[p++]; sub.push(...data.subarray(p, p + n)); p += n; }
  const clear = 1 << min, eoi = clear + 1;
  let size = min + 1, dict = [], prev = null, bit = 0;
  const out = [];
  const reset = () => { dict = []; for (let i = 0; i < clear; i++) dict[i] = [i]; dict[clear] = []; dict[eoi] = []; size = min + 1; prev = null; };
  reset();
  for (;;) {
    if (bit >= sub.length * 8) throw new Error("ran out of data");
    let code = 0;
    for (let i = 0; i < size; i++, bit++) code |= ((sub[bit >> 3] >> (bit & 7)) & 1) << i;
    if (code === clear) { reset(); continue; }
    if (code === eoi) break;
    let entry;
    if (code < dict.length) entry = dict[code];
    else if (code === dict.length && prev) entry = [...prev, prev[0]];
    else throw new Error('bad code ' + code);
    out.push(...entry);
    if (prev && dict.length < 4096) dict.push([...prev, entry[0]]);
    if (dict.length === 1 << size && size < 12) size++;
    prev = entry;
  }
  return out;
}

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('GIF LZW round-trips, including dictionary resets', () => {
  const r = rand(7);
  const cases = [
    new Uint8Array(1),
    Uint8Array.from({ length: 5000 }, (_, i) => (i >> 6) & 3), // long runs
    Uint8Array.from({ length: 60000 }, () => Math.floor(r() * 256)), // forces many clears
    Uint8Array.from({ length: 30000 }, () => Math.floor(r() * 5)),
  ];
  for (const c of cases) assert.deepEqual(lzwDecode(lzwEncode(c, 8)), Array.from(c));
  const small = Uint8Array.from({ length: 4000 }, () => Math.floor(r() * 4));
  assert.deepEqual(lzwDecode(lzwEncode(small, 2)), Array.from(small));
});

test('GIF palette keeps exact brand colours and maps them back', () => {
  const w = 40, h = 20;
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const c = i % w < 20 ? [0xc5, 0xd9, 0x2f] : [0xdd, 0xdd, 0xdd];
    px.set([...c, i % w === 39 ? 0 : 255], i * 4);
  }
  const pal = buildPalette([px], 255, true);
  const colours = [];
  for (let i = 0; i < pal.palette.length; i += 3) colours.push([...pal.palette.subarray(i, i + 3)].join(','));
  assert.ok(colours.includes('197,217,47'));
  assert.ok(colours.includes('221,221,221'));
  const gif = new GIFEncoder(w, h, 24, pal, true);
  gif.addFrame(px);
  gif.addFrame(px);
  return bytes(gif.finish()).then((b) => {
    assert.equal(new TextDecoder().decode(b.subarray(0, 6)), 'GIF89a');
    assert.equal(b[b.length - 1], 0x3b);
  });
});

function readChunks(b) {
  const out = [];
  let p = 8;
  const dv = new DataView(b.buffer, b.byteOffset);
  while (p < b.length) {
    const len = dv.getUint32(p);
    const type = new TextDecoder().decode(b.subarray(p + 4, p + 8));
    const data = b.subarray(p + 8, p + 8 + len);
    assert.equal(dv.getUint32(p + 8 + len), crc32(b.subarray(p + 4, p + 8 + len)), `CRC of ${type}`);
    out.push({ type, data });
    p += 12 + len;
  }
  return out;
}

function unfilter(raw, w, h) {
  const stride = w * 4, out = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i];
      const a = i >= 4 ? out[y * stride + i - 4] : 0;
      const b = y ? out[(y - 1) * stride + i] : 0;
      const c = y && i >= 4 ? out[(y - 1) * stride + i - 4] : 0;
      let pred = 0;
      if (f === 1) pred = a; else if (f === 2) pred = b; else if (f === 3) pred = (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[y * stride + i] = (x + pred) & 255;
    }
  }
  return out;
}

test('PNG and APNG decode back to the exact RGBA pixels', async () => {
  const w = 23, h = 17, r = rand(3);
  const frames = [0, 1, 2].map(() => Uint8Array.from({ length: w * h * 4 }, (_, i) => (i % 7 < 3 ? Math.floor(r() * 256) : (i >> 5) & 255)));
  const png = readChunks(await bytes(await encodePNG(frames[0], w, h)));
  assert.deepEqual(png.map((c) => c.type), ['IHDR', 'IDAT', 'IEND']);
  assert.deepEqual(unfilter(zlib.inflateSync(png[1].data), w, h), frames[0]);

  const apng = new APNGEncoder(w, h, 30);
  for (const f of frames) await apng.addFrame(f);
  const ch = readChunks(await bytes(apng.finish()));
  assert.deepEqual(ch.map((c) => c.type), ['IHDR', 'acTL', 'fcTL', 'IDAT', 'fcTL', 'fdAT', 'fcTL', 'fdAT', 'IEND']);
  const seq = ch.filter((c) => c.type === 'fcTL' || c.type === 'fdAT').map((c) => new DataView(c.data.buffer, c.data.byteOffset).getUint32(0));
  assert.deepEqual(seq, [0, 1, 2, 3, 4]);
  assert.deepEqual(unfilter(zlib.inflateSync(ch[5].data.subarray(4)), w, h), frames[1]);
});

test('ZIP: entries, CRCs and central directory line up', async () => {
  const zip = new ZipWriter();
  const a = new TextEncoder().encode('hello'), b = new Uint8Array(1000).fill(9);
  zip.add('a.txt', a);
  zip.add('dir_0001.bin', b);
  const z = await bytes(zip.finish());
  const dv = new DataView(z.buffer);
  const end = z.length - 22;
  assert.equal(dv.getUint32(end, true), 0x06054b50);
  assert.equal(dv.getUint16(end + 10, true), 2);
  let p = dv.getUint32(end + 16, true);
  for (const [name, data] of [['a.txt', a], ['dir_0001.bin', b]]) {
    assert.equal(dv.getUint32(p, true), 0x02014b50);
    assert.equal(dv.getUint32(p + 16, true), crc32(data));
    const nl = dv.getUint16(p + 28, true);
    assert.equal(new TextDecoder().decode(z.subarray(p + 46, p + 46 + nl)), name);
    const off = dv.getUint32(p + 42, true);
    assert.equal(dv.getUint32(off, true), 0x04034b50);
    const ln = dv.getUint16(off + 26, true);
    assert.deepEqual(z.subarray(off + 30 + ln, off + 30 + ln + data.length), data);
    p += 46 + nl;
  }
});

test('WebM: alpha track flags and block additions are written', async () => {
  const mux = new WebMMuxer({ width: 64, height: 32, fps: 25, alpha: true });
  for (let i = 0; i < 4; i++) mux.addFrame(new Uint8Array([1, 2, 3, i]), i, i === 0, new Uint8Array([9, 9, i]));
  const b = await bytes(mux.finish());
  const hex = Buffer.from(b).toString('hex');
  assert.ok(hex.startsWith('1a45dfa3'));
  assert.ok(hex.includes('53c08101'), 'AlphaMode = 1');
  assert.ok(hex.includes('55ee8101'), 'MaxBlockAdditionID = 1');
  assert.equal(hex.split('75a1').length - 1, 4, 'one BlockAdditions per frame');
  assert.ok(hex.includes('86' + '85' + Buffer.from('V_VP9').toString('hex')));
});

test('MP4: box tree and sample tables', async () => {
  const mux = new MP4Muxer({ width: 320, height: 240, fps: 30 });
  const sizes = [100, 20, 30, 40];
  sizes.forEach((n, i) => mux.addFrame(new Uint8Array(n).fill(i), i === 0, i === 0 ? new Uint8Array([1, 2, 3]) : undefined));
  const b = await bytes(mux.finish());
  const dv = new DataView(b.buffer);
  const top = [];
  for (let p = 0; p < b.length;) { const n = dv.getUint32(p); top.push([new TextDecoder().decode(b.subarray(p + 4, p + 8)), p, n]); p += n; }
  assert.deepEqual(top.map((t) => t[0]), ['ftyp', 'moov', 'mdat']);
  const s = Buffer.from(b);
  const stco = s.indexOf('stco');
  const off = dv.getUint32(stco + 12);
  assert.equal(off, top[2][1] + 8, 'chunk offset points at mdat payload');
  assert.equal(b[off + 100], 1, 'second sample follows the first');
  const stsz = s.indexOf('stsz');
  assert.deepEqual([0, 1, 2, 3].map((i) => dv.getUint32(stsz + 16 + 4 * i)), sizes);
  const stts = s.indexOf('stts');
  assert.equal(dv.getUint32(stts + 16), 3000, '90 kHz / 30 fps');
});
