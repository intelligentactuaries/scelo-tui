// A ZIP container, because .xlsx is one.
//
// Written by hand rather than pulled from npm: the format needed here is a
// 1989-vintage subset (a handful of little-endian structs), the writer is
// shorter than most lockfile diffs, and the TUI's dependency surface stays
// three packages. Entries are deflated via node:zlib — Excel neither needs
// nor rewards anything fancier — and fall back to STORE when deflate does
// not help, which is what every mainstream zip tool does.
//
// Verified against Python's `zipfile` in tests: an independent reader that
// checks CRCs on extraction, so a bug here fails loudly rather than
// producing a workbook only we can open.

import { deflateRawSync } from "node:zlib";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS packed date/time, the only clock the zip format has. Two-second
 *  resolution and a 1980 epoch — both fine for "when was this exported". */
function dosDateTime(d: Date): { date: number; time: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
  };
}

export type ZipEntry = { name: string; data: Uint8Array };

export function buildZip(entries: ZipEntry[], mtime: Date = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const { date, time } = dosDateTime(mtime);
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = enc.encode(entry.name);
    const crc = crc32(entry.data);
    const deflated = deflateRawSync(entry.data);
    // STORE when deflate loses — tiny XML parts often incompress.
    const useDeflate = deflated.length < entry.data.length;
    const payload = useDeflate ? new Uint8Array(deflated) : entry.data;
    const method = useDeflate ? 8 : 0;

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0, true); // flags
    lv.setUint16(8, method, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, payload.length, true);
    lv.setUint32(22, entry.data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true); // extra length
    local.set(name, 30);

    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, payload.length, true);
    cv.setUint32(24, entry.data.length, true);
    cv.setUint16(28, name.length, true);
    // 30..40: extra/comment/disk/attrs — all zero.
    cv.setUint32(42, offset, true);
    cd.set(name, 46);

    parts.push(local, payload);
    central.push(cd);
    offset += local.length + payload.length;
  }

  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const total = offset + cdSize + 22;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of [...parts, ...central, eocd]) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
