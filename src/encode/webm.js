// WebM muxer for one VP9 (or VP8) video track, with optional alpha.
// Alpha follows the WebM convention: a second encoded stream whose luma is the
// alpha channel, stored as BlockAdditional (BlockAddID 1) with AlphaMode = 1.
// Chrome, Firefox and ffmpeg (libvpx decoders) read it.

function idBytes(id) {
  const out = [];
  while (id > 0) { out.unshift(id & 255); id = Math.floor(id / 256); }
  return new Uint8Array(out);
}

function sizeBytes(n) {
  // EBML variable-length size; never use the all-ones (unknown) value.
  let len = 1;
  while (n >= 2 ** (7 * len) - 1) len++;
  const out = new Uint8Array(len);
  let v = n;
  for (let i = len - 1; i >= 0; i--) { out[i] = v % 256; v = Math.floor(v / 256); }
  out[0] |= 1 << (8 - len);
  return out;
}

function uint(n) {
  const out = [];
  do { out.unshift(n % 256); n = Math.floor(n / 256); } while (n > 0);
  return new Uint8Array(out);
}

function sint(n) {
  // Big-endian two's complement, 1–2 bytes is enough for frame offsets.
  const b = new Uint8Array(2);
  new DataView(b.buffer).setInt16(0, n);
  return b;
}

function float64(x) {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, x);
  return b;
}

const str = (s) => new TextEncoder().encode(s);

/** An element as a flat list of byte parts. */
function el(id, ...children) {
  const parts = [];
  for (const c of children) {
    if (c instanceof Uint8Array) parts.push(c);
    else parts.push(...c);
  }
  let size = 0;
  for (const p of parts) size += p.byteLength;
  return [idBytes(id), sizeBytes(size), ...parts];
}

export class WebMMuxer {
  /**
   * @param {{ width: number, height: number, fps: number, codec?: 'V_VP9'|'V_VP8', alpha?: boolean }} o
   */
  constructor({ width, height, fps, codec = 'V_VP9', alpha = false }) {
    this.width = width; this.height = height;
    this.fps = fps;
    this.codec = codec;
    this.alpha = alpha;
    this.clusters = [];
    this.cluster = null;
    this.frames = 0;
  }

  /**
   * @param {Uint8Array} data encoded frame
   * @param {number} index frame number
   * @param {boolean} key keyframe
   * @param {Uint8Array} [alphaData] encoded alpha frame
   */
  addFrame(data, index, key, alphaData) {
    const ms = Math.round((index * 1000) / this.fps);
    this.frames = index + 1;
    if (!this.cluster || key || ms - this.cluster.ms > 30000) {
      this.cluster = { ms, parts: [el(0xe7, uint(ms))] };
      this.clusters.push(this.cluster);
    }
    const rel = ms - this.cluster.ms;
    const head = new Uint8Array([0x81, 0, 0, 0]);
    new DataView(head.buffer).setInt16(1, rel);
    if (!this.alpha) {
      head[3] = key ? 0x80 : 0;
      this.cluster.parts.push(el(0xa3, head, data));
      return;
    }
    const children = [el(0xa1, head, data)];
    if (alphaData && alphaData.byteLength) {
      children.push(el(0x75a1, el(0xa6, el(0xee, uint(1)), el(0xa5, alphaData))));
    }
    if (!key) children.push(el(0xfb, sint(-Math.round(1000 / this.fps))));
    this.cluster.parts.push(el(0xa0, ...children));
  }

  finish() {
    const header = el(0x1a45dfa3,
      el(0x4286, uint(1)), el(0x42f7, uint(1)), el(0x42f2, uint(4)), el(0x42f3, uint(8)),
      el(0x4282, str('webm')), el(0x4287, uint(4)), el(0x4285, uint(2)));
    const durationMs = (this.frames * 1000) / this.fps;
    const info = el(0x1549a966,
      el(0x2ad7b1, uint(1000000)),
      el(0x4d80, str('Blobs')), el(0x5741, str('Blobs')),
      el(0x4489, float64(durationMs)));
    const video = [el(0xb0, uint(this.width)), el(0xba, uint(this.height)),
      // BT.601 matrix, BT.709 primaries/transfer, broadcast range: matches export.js.
      el(0x55b0, el(0x55b1, uint(6)), el(0x55b9, uint(1)), el(0x55ba, uint(1)), el(0x55bb, uint(1)))];
    if (this.alpha) video.push(el(0x53c0, uint(1)));
    const track = [
      el(0xd7, uint(1)), el(0x73c5, uint(1)), el(0x83, uint(1)),
      el(0x9c, uint(0)), el(0x86, str(this.codec)),
      el(0x23e383, uint(Math.round(1e9 / this.fps))),
      el(0xe0, ...video),
    ];
    if (this.alpha) track.push(el(0x55ee, uint(1)));
    const tracks = el(0x1654ae6b, el(0xae, ...track));
    const clusters = this.clusters.map((c) => el(0x1f43b675, ...c.parts));
    const segment = el(0x18538067, info, tracks, ...clusters);
    return new Blob([...header, ...segment], { type: 'video/webm' });
  }
}
