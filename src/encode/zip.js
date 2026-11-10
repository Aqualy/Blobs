// Minimal ZIP writer (stored, no compression: PNG data is already deflated).
import { Writer, crc32 } from './bytes.js';

export class ZipWriter {
  constructor() {
    this.parts = [];
    this.entries = [];
    this.offset = 0;
    const d = new Date();
    this.time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    this.date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  }

  /** @param {string} name ASCII path  @param {Uint8Array} data */
  add(name, data) {
    const crc = crc32(data);
    const head = new Writer(30 + name.length)
      .u32le(0x04034b50).u16le(20).u16le(0).u16le(0)
      .u16le(this.time).u16le(this.date)
      .u32le(crc).u32le(data.length).u32le(data.length)
      .u16le(name.length).u16le(0).ascii(name).out();
    this.entries.push({ name, crc, size: data.length, offset: this.offset });
    this.parts.push(head, data);
    this.offset += head.length + data.length;
  }

  finish() {
    const dir = new Writer(64 * this.entries.length + 22);
    for (const e of this.entries) {
      dir.u32le(0x02014b50).u16le(20).u16le(20).u16le(0).u16le(0)
        .u16le(this.time).u16le(this.date)
        .u32le(e.crc).u32le(e.size).u32le(e.size)
        .u16le(e.name.length).u16le(0).u16le(0).u16le(0).u16le(0).u32le(0)
        .u32le(e.offset).ascii(e.name);
    }
    const dirLen = dir.len;
    dir.u32le(0x06054b50).u16le(0).u16le(0)
      .u16le(this.entries.length).u16le(this.entries.length)
      .u32le(dirLen).u32le(this.offset).u16le(0);
    return new Blob([...this.parts, dir.out()], { type: 'application/zip' });
  }
}
