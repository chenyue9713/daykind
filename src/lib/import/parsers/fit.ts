// FIT (Garmin Flexible and Interoperable Data Transfer) adapter. A small,
// dependency-free decoder that works on an in-memory copy with explicit
// bounds: header and file CRCs are verified, every read is range-checked, and
// message count and time are capped. Only the fields DayKind summarizes are
// read; positions (record fields 0/1), raw sensor streams, and device serial
// numbers are skipped and never leave this module.
import { Deadline, MAX_FIT_CHAINED_FILES, MAX_FIT_DEFINITIONS, MAX_FIT_MESSAGES, MAX_SESSIONS_PER_FILE } from "../limits";
import { isFitHeader } from "../sniff";
import { ImportFailure, type ParsedFile, type ParsedSession } from "../types";
import { HeartRateSamples, isPlausibleHeartRate, NO_HEART_RATE } from "./heart-rate";

export const FIT_DECODER_VERSION = "daykind-fit-1";

/** Seconds between the Unix epoch and the FIT epoch (1989-12-31T00:00:00Z). */
export const FIT_EPOCH_OFFSET = 631_065_600;

// Global message numbers and field numbers from the FIT profile.
export const MESG = { fileId: 0, session: 18, lap: 19, record: 20, event: 21, activity: 34 } as const;
export const FILE_ID = { type: 0, manufacturer: 1, product: 2, serialNumber: 3, timeCreated: 4 } as const;
export const SESSION = {
  startTime: 2,
  sport: 5,
  subSport: 6,
  totalElapsedTime: 7,
  totalTimerTime: 8,
  totalDistance: 9,
  avgHeartRate: 16,
  maxHeartRate: 17,
  timestamp: 253,
  messageIndex: 254,
} as const;
export const ACTIVITY = { totalTimerTime: 0, numSessions: 1, type: 2, localTimestamp: 5, timestamp: 253 } as const;
export const RECORD = { heartRate: 3, timestamp: 253 } as const;
export const FILE_TYPE_ACTIVITY = 4;
const TIMESTAMP_FIELD = 253;

/** Messages and fields this decoder reads; everything else is skipped by size. */
const WANTED: Record<number, ReadonlySet<number>> = {
  [MESG.fileId]: new Set([FILE_ID.type, FILE_ID.manufacturer, FILE_ID.product, FILE_ID.timeCreated]),
  [MESG.session]: new Set(Object.values(SESSION)),
  [MESG.activity]: new Set(Object.values(ACTIVITY)),
  [MESG.record]: new Set(Object.values(RECORD)),
};

export const SPORTS: Record<number, string> = {
  0: "generic", 1: "running", 2: "cycling", 3: "transition", 4: "fitness_equipment", 5: "swimming",
  6: "basketball", 7: "soccer", 8: "tennis", 9: "american_football", 10: "training", 11: "walking",
  12: "cross_country_skiing", 13: "alpine_skiing", 14: "snowboarding", 15: "rowing", 16: "mountaineering",
  17: "hiking", 18: "multisport", 19: "paddling", 20: "flying", 21: "e_biking",
};

export const SUB_SPORTS: Record<number, string> = {
  0: "generic", 1: "treadmill", 2: "street", 3: "trail", 4: "track", 5: "spin", 6: "indoor_cycling",
  7: "road", 8: "mountain", 9: "downhill", 10: "recumbent", 11: "cyclocross", 12: "hand_cycling",
  13: "track_cycling", 14: "indoor_rowing", 15: "elliptical", 16: "stair_climbing", 17: "lap_swimming",
  18: "open_water", 19: "flexibility_training", 20: "strength_training", 21: "warm_up", 22: "match",
  23: "exercise", 24: "challenge", 25: "indoor_skiing", 26: "cardio_training", 27: "indoor_walking",
  28: "e_bike_fitness", 29: "bmx", 30: "casual_walking", 31: "speed_walking", 43: "yoga", 44: "pilates",
  45: "indoor_running", 46: "gravel_cycling", 47: "e_bike_mountain", 48: "commuting", 49: "mixed_surface",
  58: "virtual_activity", 59: "obstacle",
};

const MANUFACTURERS: Record<number, string> = {
  1: "Garmin", 23: "Suunto", 32: "Wahoo", 69: "Stages", 89: "Tacx", 255: "Development", 265: "Strava",
  294: "Coros", 260: "Zwift", 289: "Hammerhead",
};

// Base types: size and invalid value. Index is the low 5 bits of the base type byte.
interface BaseType {
  size: number;
  invalid: number | bigint | null;
}
const BASE_TYPES: Record<number, BaseType> = {
  0x00: { size: 1, invalid: 0xff }, // enum
  0x01: { size: 1, invalid: 0x7f }, // sint8
  0x02: { size: 1, invalid: 0xff }, // uint8
  0x03: { size: 2, invalid: 0x7fff }, // sint16
  0x04: { size: 2, invalid: 0xffff }, // uint16
  0x05: { size: 4, invalid: 0x7fffffff }, // sint32
  0x06: { size: 4, invalid: 0xffffffff }, // uint32
  0x07: { size: 1, invalid: null }, // string
  0x08: { size: 4, invalid: null }, // float32 (invalid is NaN pattern)
  0x09: { size: 8, invalid: null }, // float64
  0x0a: { size: 1, invalid: 0x00 }, // uint8z
  0x0b: { size: 2, invalid: 0x0000 }, // uint16z
  0x0c: { size: 4, invalid: 0x00000000 }, // uint32z
  0x0d: { size: 1, invalid: 0xff }, // byte
  0x0e: { size: 8, invalid: null }, // sint64
  0x0f: { size: 8, invalid: null }, // uint64
  0x10: { size: 8, invalid: null }, // uint64z
};

interface FieldDef {
  num: number;
  size: number;
  baseType: number;
}

interface Definition {
  global: number;
  littleEndian: boolean;
  fields: FieldDef[];
  devFieldsSize: number;
  totalSize: number;
}

type Values = Map<number, number>;

const corrupt = (detail: string) =>
  new ImportFailure("corrupt", `This FIT file is damaged (${detail}). Export the workout again, or add it manually.`);

const CRC_TABLE = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01,
  0x8801, 0x4400,
];

export function fitCrc(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0;
  for (let i = start; i < end; i++) {
    const byte = bytes[i];
    let tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[byte & 0xf];
    tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[(byte >> 4) & 0xf];
  }
  return crc;
}

function readScalar(view: DataView, offset: number, field: FieldDef, littleEndian: boolean): number | null {
  const type = BASE_TYPES[field.baseType & 0x1f];
  if (!type || type.size !== field.size) return null; // arrays and strings are not needed
  let value: number;
  switch (field.baseType & 0x1f) {
    case 0x00:
    case 0x02:
    case 0x0a:
    case 0x0d:
      value = view.getUint8(offset);
      break;
    case 0x01:
      value = view.getInt8(offset);
      break;
    case 0x03:
      value = view.getInt16(offset, littleEndian);
      break;
    case 0x04:
    case 0x0b:
      value = view.getUint16(offset, littleEndian);
      break;
    case 0x05:
      value = view.getInt32(offset, littleEndian);
      break;
    case 0x06:
    case 0x0c:
      value = view.getUint32(offset, littleEndian);
      break;
    case 0x08:
      value = view.getFloat32(offset, littleEndian);
      return Number.isFinite(value) ? value : null;
    case 0x09:
      value = view.getFloat64(offset, littleEndian);
      return Number.isFinite(value) ? value : null;
    default:
      return null;
  }
  return value === type.invalid ? null : value;
}

interface Collected {
  fileType: number | null;
  manufacturer: number | null;
  product: number | null;
  timeCreated: number | null;
  sessions: Values[];
  activities: Values[];
  hr: HeartRateSamples;
}

function decodeChain(bytes: Uint8Array, deadline: Deadline): Collected {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Collected = {
    fileType: null,
    manufacturer: null,
    product: null,
    timeCreated: null,
    sessions: [],
    activities: [],
    hr: new HeartRateSamples(),
  };
  let messages = 0;
  let definitionsSeen = 0;
  let offset = 0;
  let files = 0;

  while (offset < bytes.length) {
    if (++files > MAX_FIT_CHAINED_FILES) throw new ImportFailure("too_complex", "This FIT file contains too many joined files to read safely.");
    const header = bytes.subarray(offset);
    if (header.length < 12 || !isFitHeader(header)) {
      if (files === 1) throw corrupt("invalid header");
      // Trailing padding after a complete file is tolerated; anything else is not.
      if (header.every((b) => b === 0)) break;
      throw corrupt("unexpected data after the end of the file");
    }
    const headerSize = header[0];
    const dataSize = view.getUint32(offset + 4, true);
    if (headerSize === 14) {
      const headerCrc = view.getUint16(offset + 12, true);
      if (headerCrc !== 0 && headerCrc !== fitCrc(bytes, offset, offset + 12)) throw corrupt("header checksum mismatch");
    }
    const dataStart = offset + headerSize;
    const dataEnd = dataStart + dataSize;
    if (dataEnd + 2 > bytes.length) throw corrupt("file is truncated");
    const fileCrc = view.getUint16(dataEnd, true);
    if (fileCrc !== fitCrc(bytes, offset, dataEnd)) throw corrupt("checksum mismatch");

    const definitions: (Definition | undefined)[] = new Array(16);
    let lastTimestamp: number | null = null;
    let pos = dataStart;

    while (pos < dataEnd) {
      if (++messages > MAX_FIT_MESSAGES) throw new ImportFailure("too_complex", "This FIT file has too many records to read safely.");
      if ((messages & 0xfff) === 0 && deadline.expired) {
        throw new ImportFailure("timeout", "This file took too long to read and was stopped. Export a single workout instead.");
      }
      const recordHeader = bytes[pos++];
      let localType: number;
      let compressedOffset: number | null = null;

      if (recordHeader & 0x80) {
        localType = (recordHeader >> 5) & 0x03;
        compressedOffset = recordHeader & 0x1f;
      } else if (recordHeader & 0x40) {
        // Definition message.
        if (++definitionsSeen > MAX_FIT_DEFINITIONS) throw new ImportFailure("too_complex", "This FIT file is too complex to read safely.");
        const hasDevFields = (recordHeader & 0x20) !== 0;
        if (pos + 5 > dataEnd) throw corrupt("truncated definition");
        const littleEndian = bytes[pos + 1] === 0;
        if (bytes[pos + 1] > 1) throw corrupt("unknown byte order");
        const global = view.getUint16(pos + 2, littleEndian);
        const fieldCount = bytes[pos + 4];
        pos += 5;
        if (pos + fieldCount * 3 > dataEnd) throw corrupt("truncated definition");
        const fields: FieldDef[] = [];
        let totalSize = 0;
        for (let i = 0; i < fieldCount; i++) {
          const field = { num: bytes[pos], size: bytes[pos + 1], baseType: bytes[pos + 2] };
          if (field.size === 0) throw corrupt("invalid field size");
          fields.push(field);
          totalSize += field.size;
          pos += 3;
        }
        let devFieldsSize = 0;
        if (hasDevFields) {
          if (pos + 1 > dataEnd) throw corrupt("truncated definition");
          const devCount = bytes[pos++];
          if (pos + devCount * 3 > dataEnd) throw corrupt("truncated definition");
          for (let i = 0; i < devCount; i++) devFieldsSize += bytes[pos + i * 3 + 1];
          pos += devCount * 3;
        }
        definitions[recordHeader & 0x0f] = { global, littleEndian, fields, devFieldsSize, totalSize: totalSize + devFieldsSize };
        continue;
      } else {
        localType = recordHeader & 0x0f;
      }

      const def = definitions[localType];
      if (!def) throw corrupt("data before its definition");
      if (pos + def.totalSize > dataEnd) throw corrupt("truncated record");

      const wanted = WANTED[def.global];
      let timestamp: number | null = null;
      const values: Values | null = wanted ? new Map() : null;
      let fieldPos = pos;
      for (const field of def.fields) {
        if (field.num === TIMESTAMP_FIELD || wanted?.has(field.num)) {
          const value = readScalar(view, fieldPos, field, def.littleEndian);
          if (field.num === TIMESTAMP_FIELD && value !== null) timestamp = value;
          if (values && value !== null && wanted?.has(field.num)) values.set(field.num, value);
        }
        fieldPos += field.size;
      }
      pos += def.totalSize;

      if (compressedOffset !== null) {
        if (lastTimestamp === null) throw corrupt("compressed timestamp without a reference time");
        let t: number = (lastTimestamp & ~0x1f) + compressedOffset;
        if (compressedOffset < (lastTimestamp & 0x1f)) t += 0x20;
        timestamp = t >>> 0;
        values?.set(TIMESTAMP_FIELD, timestamp);
      }
      if (timestamp !== null) lastTimestamp = timestamp;
      if (!values) continue;

      switch (def.global) {
        case MESG.fileId:
          out.fileType ??= values.get(FILE_ID.type) ?? null;
          out.manufacturer ??= values.get(FILE_ID.manufacturer) ?? null;
          out.product ??= values.get(FILE_ID.product) ?? null;
          out.timeCreated ??= values.get(FILE_ID.timeCreated) ?? null;
          break;
        case MESG.session:
          if (out.sessions.length >= MAX_SESSIONS_PER_FILE) {
            throw new ImportFailure("too_complex", `This file has more than ${MAX_SESSIONS_PER_FILE} sessions. Export them one at a time.`);
          }
          out.sessions.push(values);
          break;
        case MESG.activity:
          out.activities.push(values);
          break;
        case MESG.record: {
          const hr = values.get(RECORD.heartRate);
          if (timestamp !== null && hr !== undefined) out.hr.add(timestamp + FIT_EPOCH_OFFSET, hr);
          break;
        }
      }
    }
    offset = dataEnd + 2;
  }
  return out;
}

const isoOf = (fitSeconds: number) => new Date((fitSeconds + FIT_EPOCH_OFFSET) * 1000).toISOString();

export function parseFit(bytes: Uint8Array, deadline = new Deadline()): ParsedFile {
  const data = decodeChain(bytes, deadline);

  if (data.fileType !== null && data.fileType !== FILE_TYPE_ACTIVITY) {
    throw new ImportFailure(
      "not_an_activity",
      "This FIT file is not a recorded activity (it may be a course, workout plan, or device settings). Export the completed activity instead.",
    );
  }
  if (data.sessions.length === 0) {
    throw new ImportFailure(
      "no_sessions",
      "No workout sessions were found in this FIT file. It may be incomplete; export it again, or add the workout manually.",
    );
  }

  // The activity message records local time; its difference from UTC is the device's offset.
  const activity = data.activities.find((a) => a.has(ACTIVITY.localTimestamp) && a.has(ACTIVITY.timestamp));
  let utcOffsetMinutes: number | null = null;
  const warnings: string[] = [];
  if (activity) {
    const delta = (activity.get(ACTIVITY.localTimestamp)! - activity.get(ACTIVITY.timestamp)!) / 60;
    // Offsets are whole quarter-hours within −12 h … +14 h; anything else is not trusted.
    if (delta >= -12 * 60 && delta <= 14 * 60 && Math.abs(delta - Math.round(delta / 15) * 15) <= 1) {
      utcOffsetMinutes = Math.round(delta / 15) * 15;
    } else {
      warnings.push("The device's local-time offset was not plausible and was ignored.");
    }
  }

  const manufacturer = data.manufacturer !== null ? (MANUFACTURERS[data.manufacturer] ?? null) : null;
  const sessions = [...data.sessions]
    .sort((a, b) => (a.get(SESSION.startTime) ?? 0) - (b.get(SESSION.startTime) ?? 0))
    .map((s, index) => toSession(s, index, utcOffsetMinutes, data));

  return {
    format: "fit",
    decoderVersion: FIT_DECODER_VERSION,
    deviceLabel: manufacturer ? `${manufacturer} device` : null,
    sessions,
    warnings,
  };
}

function toSession(s: Values, index: number, utcOffsetMinutes: number | null, data: Collected): ParsedSession {
  const errors: string[] = [];
  const warnings: string[] = [];
  const start = s.get(SESSION.startTime) ?? null;
  const end = s.get(SESSION.timestamp) ?? null;
  if (start === null) errors.push("No start time was recorded for this session.");

  const elapsedRaw = s.get(SESSION.totalElapsedTime);
  const timerRaw = s.get(SESSION.totalTimerTime);
  let elapsedSeconds: number | null = elapsedRaw !== undefined ? Math.round(elapsedRaw / 1000) : null;
  let elapsedSource: ParsedSession["elapsedSource"] = elapsedSeconds !== null ? "device" : null;
  if (elapsedSeconds === null && start !== null && end !== null && end > start) {
    elapsedSeconds = end - start;
    elapsedSource = "derived";
  }
  const timerSeconds = timerRaw !== undefined ? Math.round(timerRaw / 1000) : null;
  if ((elapsedSeconds === null || elapsedSeconds <= 0) && !(timerSeconds !== null && timerSeconds > 0)) {
    errors.push("No duration was recorded for this session.");
  }

  const distanceRaw = s.get(SESSION.totalDistance);
  const distanceMeters = distanceRaw !== undefined ? distanceRaw / 100 : null;

  const avg = s.get(SESSION.avgHeartRate) ?? null;
  const max = s.get(SESSION.maxHeartRate) ?? null;
  let heartRate = NO_HEART_RATE;
  if (isPlausibleHeartRate(avg) || isPlausibleHeartRate(max)) {
    heartRate = {
      avgBpm: isPlausibleHeartRate(avg) ? avg : null,
      maxBpm: isPlausibleHeartRate(max) ? max : null,
      basis: "device_summary",
      coverage: null,
    };
  } else if (start !== null && elapsedSeconds !== null) {
    const startUnix = start + FIT_EPOCH_OFFSET;
    heartRate = data.hr.summarize(startUnix, startUnix + elapsedSeconds, timerSeconds);
  }
  if ((avg !== null && !isPlausibleHeartRate(avg)) || (max !== null && !isPlausibleHeartRate(max))) {
    warnings.push("A heart-rate summary was outside 25–250 bpm and was ignored.");
  }

  const sport = s.get(SESSION.sport);
  const subSport = s.get(SESSION.subSport);
  const created = data.timeCreated ?? start;
  return {
    index,
    sport: sport !== undefined ? (SPORTS[sport] ?? `sport_${sport}`) : null,
    subSport: subSport !== undefined ? (SUB_SPORTS[subSport] ?? `sub_sport_${subSport}`) : null,
    startedAt: start !== null ? isoOf(start) : null,
    startIsFloating: false,
    utcOffsetMinutes,
    elapsedSeconds: elapsedSeconds !== null && elapsedSeconds > 0 ? elapsedSeconds : null,
    elapsedSource,
    timerSeconds,
    distanceMeters,
    heartRate,
    // Manufacturer, product, and creation time identify the recording without the serial number.
    providerId: created !== null ? `fit:${data.manufacturer ?? "x"}:${data.product ?? "x"}:${created}:${start ?? "x"}` : null,
    errors,
    warnings,
  };
}
