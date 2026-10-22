// A tiny FIT encoder for building test fixtures. It writes real FIT
// structure (header, definitions, data, compressed timestamps, developer
// fields, CRCs) so the decoder is exercised the way device files exercise it.
import { FIT_EPOCH_OFFSET, fitCrc } from "../parsers/fit";

export const T = {
  enum: 0x00,
  sint8: 0x01,
  uint8: 0x02,
  sint16: 0x83,
  uint16: 0x84,
  sint32: 0x85,
  uint32: 0x86,
  string: 0x07,
  uint32z: 0x8c,
} as const;

const SIZES: Record<number, number> = { 0x00: 1, 0x01: 1, 0x02: 1, 0x83: 2, 0x84: 2, 0x85: 4, 0x86: 4, 0x8c: 4 };
const INVALID: Record<number, number> = { 0x00: 0xff, 0x01: 0x7f, 0x02: 0xff, 0x83: 0x7fff, 0x84: 0xffff, 0x85: 0x7fffffff, 0x86: 0xffffffff, 0x8c: 0 };

interface Def {
  global: number;
  fields: [num: number, baseType: number, size?: number][];
  bigEndian: boolean;
  devFieldSizes: number[];
}

export class FitBuilder {
  private bytes: number[] = [];
  private defs = new Map<number, Def>();

  define(local: number, global: number, fields: Def["fields"], opts: { bigEndian?: boolean; devFieldSizes?: number[] } = {}): this {
    const dev = opts.devFieldSizes ?? [];
    const def: Def = { global, fields, bigEndian: opts.bigEndian ?? false, devFieldSizes: dev };
    this.defs.set(local, def);
    this.bytes.push(0x40 | (dev.length ? 0x20 : 0) | local, 0, def.bigEndian ? 1 : 0);
    this.push16(global, def.bigEndian);
    this.bytes.push(fields.length);
    for (const [num, type, size] of fields) this.bytes.push(num, size ?? SIZES[type], type);
    if (dev.length) {
      this.bytes.push(dev.length);
      dev.forEach((size, i) => this.bytes.push(i, size, 0));
    }
    return this;
  }

  /** `null` writes the base type's invalid value. Strings are given as JS strings. */
  data(local: number, values: (number | string | null)[], compressedOffset?: number): this {
    const def = this.defs.get(local);
    if (!def) throw new Error(`no definition for local ${local}`);
    this.bytes.push(compressedOffset === undefined ? local : 0x80 | (local << 5) | (compressedOffset & 0x1f));
    def.fields.forEach(([, type, size], i) => {
      const value = values[i];
      if (type === T.string) {
        const width = size ?? 1;
        const encoded = Array.from(new TextEncoder().encode(String(value ?? ""))).slice(0, width - 1);
        while (encoded.length < width) encoded.push(0);
        this.bytes.push(...encoded);
        return;
      }
      this.pushValue(type, value === null ? INVALID[type] : (value as number), def.bigEndian);
    });
    for (const size of def.devFieldSizes) for (let i = 0; i < size; i++) this.bytes.push(0xaa);
    return this;
  }

  build({ headerSize = 14, headerCrc = true }: { headerSize?: 12 | 14; headerCrc?: boolean } = {}): Uint8Array {
    const header = [headerSize, 0x20];
    const profile = 2132;
    header.push(profile & 0xff, profile >> 8);
    const n = this.bytes.length;
    header.push(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff);
    header.push(0x2e, 0x46, 0x49, 0x54); // ".FIT"
    if (headerSize === 14) {
      const crc = headerCrc ? fitCrc(Uint8Array.from(header), 0, 12) : 0;
      header.push(crc & 0xff, crc >> 8);
    }
    const all = Uint8Array.from([...header, ...this.bytes, 0, 0]);
    const crc = fitCrc(all, 0, all.length - 2);
    all[all.length - 2] = crc & 0xff;
    all[all.length - 1] = crc >> 8;
    return all;
  }

  private push16(value: number, bigEndian: boolean) {
    const b = [value & 0xff, (value >> 8) & 0xff];
    this.bytes.push(...(bigEndian ? b.reverse() : b));
  }

  private pushValue(type: number, value: number, bigEndian: boolean) {
    const size = SIZES[type];
    const buf = new DataView(new ArrayBuffer(size));
    if (size === 1) buf.setUint8(0, value & 0xff);
    else if (size === 2) buf.setUint16(0, value & 0xffff, !bigEndian);
    else buf.setUint32(0, value >>> 0, !bigEndian);
    this.bytes.push(...new Uint8Array(buf.buffer));
  }
}

/** Unix ISO string → FIT timestamp. */
export const fitTime = (iso: string) => Math.round(Date.parse(iso) / 1000) - FIT_EPOCH_OFFSET;

export interface SessionSpec {
  start: string;
  elapsed: number | null;
  timer: number | null;
  distance: number | null;
  sport: number | null;
  subSport: number | null;
  avgHr: number | null;
  maxHr: number | null;
}

export interface RecordSpec {
  /** Seconds after the first session start. */
  t: number;
  hr: number | null;
}

export interface ActivitySpec {
  sessions: SessionSpec[];
  records?: RecordSpec[];
  /** Device's local-time offset; omit to leave out the activity message. */
  localOffsetMinutes?: number;
  fileType?: number;
  bigEndianSessions?: boolean;
  /** Write every other record with a compressed timestamp header. */
  compressTimestamps?: boolean;
}

/**
 * Builds a Garmin-like activity file: file_id (with a serial number that must
 * not be kept), records with GPS positions and a developer field (which must
 * be skipped), compressed-timestamp records, sessions, and the activity message.
 */
export function buildActivityFit(spec: ActivitySpec): Uint8Array {
  const b = new FitBuilder();
  const first = fitTime(spec.sessions[0].start);
  b.define(0, 0, [
    [0, T.enum],
    [1, T.uint16],
    [2, T.uint16],
    [3, T.uint32z],
    [4, T.uint32],
  ]).data(0, [spec.fileType ?? 4, 1, 3990, 3_456_789_012, first]);

  // Records: timestamp, lat, long (semicircles), heart rate; plus 2 bytes of developer data.
  b.define(1, 20, [
    [253, T.uint32],
    [0, T.sint32],
    [1, T.sint32],
    [3, T.uint8],
  ], { devFieldSizes: [2] });
  // A compressed-timestamp record type: lat, long, heart rate only.
  b.define(2, 20, [
    [0, T.sint32],
    [1, T.sint32],
    [3, T.uint8],
  ]);
  let last: number | null = null;
  for (const [i, r] of (spec.records ?? []).entries()) {
    const ts = first + r.t;
    const lat = Math.round((37.77 + i * 1e-5) * (2 ** 31 / 180));
    const long = Math.round((-122.42 + i * 1e-5) * (2 ** 31 / 180));
    if (spec.compressTimestamps && last !== null && ts - last > 0 && ts - last < 31 && i % 2 === 1) {
      b.data(2, [lat, long, r.hr], ts & 0x1f);
    } else {
      b.data(1, [ts, lat, long, r.hr]);
    }
    last = ts;
  }

  b.define(3, 18, [
    [253, T.uint32],
    [2, T.uint32],
    [5, T.enum],
    [6, T.enum],
    [7, T.uint32],
    [8, T.uint32],
    [9, T.uint32],
    [16, T.uint8],
    [17, T.uint8],
    [254, T.uint16],
  ], { bigEndian: spec.bigEndianSessions });
  spec.sessions.forEach((s, i) => {
    const start = fitTime(s.start);
    b.data(3, [
      start + (s.elapsed ?? 0),
      start,
      s.sport,
      s.subSport,
      s.elapsed === null ? null : s.elapsed * 1000,
      s.timer === null ? null : s.timer * 1000,
      s.distance === null ? null : Math.round(s.distance * 100),
      s.avgHr,
      s.maxHr,
      i,
    ]);
  });

  if (spec.localOffsetMinutes !== undefined) {
    const lastSession = spec.sessions[spec.sessions.length - 1];
    const end = fitTime(lastSession.start) + (lastSession.elapsed ?? 0);
    b.define(4, 34, [
      [253, T.uint32],
      [0, T.uint32],
      [1, T.uint16],
      [2, T.enum],
      [5, T.uint32],
    ]).data(4, [end, null, spec.sessions.length, 0, end + spec.localOffsetMinutes * 60]);
  }
  return b.build();
}
