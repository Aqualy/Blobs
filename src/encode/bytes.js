// Small byte helpers shared by the encoders (no dependencies, browser + Node).

/** Growable byte writer for headers and small structures. */
export class Writer {
  constructor(size = 256) {
    this.buf = new Uint8Array(Math.max(16, size));
    this.len = 0;
  }
  ensure(n) {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.len + n) cap *= 2;
    const b = new Uint8Array(cap);
    b.set(this.buf.subarray(0, this.len));
    this.buf = b;
  }
  u8(v) { this.ensure(1); this.buf[this.len++] = v & 255; return this; }
  u16(v) { this.ensure(2); this.buf[this.len++] = (v >>> 8) & 255; this.buf[this.len++] = v & 255; return this; }
  u16le(v) { this.ensure(2); this.buf[this.len++] = v & 255; this.buf[this.len++] = (v >>> 8) & 255; return this; }
  u32(v) {
    this.ensure(4);
    this.buf[this.len++] = (v >>> 24) & 255; this.buf[this.len++] = (v >>> 16) & 255;
    this.buf[this.len++] = (v >>> 8) & 255; this.buf[this.len++] = v & 255;
    return this;
  }
  u32le(v) {
    this.ensure(4);
    this.buf[this.len++] = v & 255; this.buf[this.len++] = (v >>> 8) & 255;
    this.buf[this.len++] = (v >>> 16) & 255; this.buf[this.len++] = (v >>> 24) & 255;
    return this;
  }
  bytes(a) { this.ensure(a.length); this.buf.set(a, this.len); this.len += a.length; return this; }
  ascii(s) { this.ensure(s.length); for (let i = 0; i < s.length; i++) this.buf[this.len++] = s.charCodeAt(i) & 255; return this; }
  zeros(n) { this.ensure(n); this.buf.fill(0, this.len, this.len + n); this.len += n; return this; }
  out() { return this.buf.slice(0, this.len); }
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (PNG / ZIP). Pass the previous value to continue over several buffers. */
export function crc32(data, crc = 0) {
  let c = ~crc >>> 0;
  for (let i = 0; i < data.length; i++) c = CRC[(c ^ data[i]) & 255] ^ (c >>> 8);
  return ~c >>> 0;
}

/** zlib (RFC 1950) compression through the platform's CompressionStream. */
export async function zlibDeflate(data) {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export const totalLength = (parts) => parts.reduce((s, p) => s + p.byteLength, 0);
