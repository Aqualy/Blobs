// MP4 muxer for one H.264 video track (AVCC samples from WebCodecs).
// moov is written before mdat ("fast start"), all samples in one chunk.
import { Writer } from './bytes.js';

function box(type, ...payload) {
  let size = 8;
  for (const p of payload) size += p.byteLength;
  const w = new Writer(size);
  w.u32(size).ascii(type);
  for (const p of payload) w.bytes(p);
  return w.out();
}

const fullBox = (type, version, flags, ...payload) =>
  box(type, new Uint8Array([version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255]), ...payload);

const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];

export class MP4Muxer {
  /** @param {{ width: number, height: number, fps: number }} o */
  constructor({ width, height, fps }) {
    this.width = width; this.height = height;
    this.fps = fps;
    this.timescale = 90000 % fps === 0 ? 90000 : fps * 1000;
    this.delta = this.timescale / fps;
    this.samples = [];
    this.keys = [];
    this.avcC = null;
  }

  /** @param {Uint8Array} data AVCC sample  @param {boolean} key  @param {Uint8Array} [description] avcC */
  addFrame(data, key, description) {
    if (description && !this.avcC) this.avcC = new Uint8Array(description);
    this.samples.push(data);
    if (key) this.keys.push(this.samples.length);
  }

  moov(dataOffset) {
    const n = this.samples.length;
    const durMovie = Math.round((n * 1000) / this.fps);
    const durMedia = n * this.delta;
    const W = this.width, H = this.height;

    const mvhd = new Writer(100).u32(0).u32(0).u32(1000).u32(durMovie)
      .u32(0x00010000).u16(0x0100).zeros(10);
    MATRIX.forEach((m) => mvhd.u32(m));
    mvhd.zeros(24).u32(2);

    const tkhd = new Writer(84).u32(0).u32(0).u32(1).u32(0).u32(durMovie)
      .zeros(8).u16(0).u16(0).u16(0).u16(0);
    MATRIX.forEach((m) => tkhd.u32(m));
    tkhd.u32(W * 65536).u32(H * 65536);

    const mdhd = new Writer(20).u32(0).u32(0).u32(this.timescale).u32(durMedia).u16(0x55c4).u16(0);
    const hdlr = new Writer(40).u32(0).ascii('vide').zeros(12).ascii('VideoHandler').u8(0);

    const avc1 = new Writer(86).zeros(6).u16(1).zeros(16).u16(W).u16(H)
      .u32(0x00480000).u32(0x00480000).u32(0).u16(1).zeros(32).u16(0x18).u16(0xffff);
    const stsd = fullBox('stsd', 0, 0, new Writer(4).u32(1).out(),
      box('avc1', avc1.out(), box('avcC', this.avcC || new Uint8Array(0)),
        // BT.709 primaries/transfer/matrix, limited range (matches export.js).
        box('colr', new Writer(11).ascii('nclx').u16(1).u16(1).u16(1).u8(0).out())));
    const stts = fullBox('stts', 0, 0, new Writer(12).u32(1).u32(n).u32(this.delta).out());
    const stssW = new Writer(4 + 4 * this.keys.length).u32(this.keys.length);
    this.keys.forEach((k) => stssW.u32(k));
    const stsc = fullBox('stsc', 0, 0, new Writer(16).u32(1).u32(1).u32(n).u32(1).out());
    const stszW = new Writer(8 + 4 * n).u32(0).u32(n);
    this.samples.forEach((s) => stszW.u32(s.byteLength));
    const stco = fullBox('stco', 0, 0, new Writer(8).u32(1).u32(dataOffset).out());

    const stbl = box('stbl', stsd, stts, fullBox('stss', 0, 0, stssW.out()), stsc, fullBox('stsz', 0, 0, stszW.out()), stco);
    const dinf = box('dinf', fullBox('dref', 0, 0, new Writer(4).u32(1).out(), fullBox('url ', 0, 1)));
    const minf = box('minf', fullBox('vmhd', 0, 1, new Uint8Array(8)), dinf, stbl);
    const mdia = box('mdia', fullBox('mdhd', 0, 0, mdhd.out()), fullBox('hdlr', 0, 0, hdlr.out()), minf);
    const trak = box('trak', fullBox('tkhd', 0, 3, tkhd.out()), mdia);
    return box('moov', fullBox('mvhd', 0, 0, mvhd.out()), trak);
  }

  finish() {
    if (!this.avcC) throw new Error('The H.264 encoder gave no decoder configuration.');
    const ftyp = box('ftyp', new Writer(24).ascii('isom').u32(512).ascii('isomiso2avc1mp41').out());
    const moovSize = this.moov(0).byteLength;
    const moov = this.moov(ftyp.byteLength + moovSize + 8);
    let mdatSize = 8;
    for (const s of this.samples) mdatSize += s.byteLength;
    const mdatHead = new Writer(8).u32(mdatSize).ascii('mdat').out();
    return new Blob([ftyp, moov, mdatHead, ...this.samples], { type: 'video/mp4' });
  }
}
