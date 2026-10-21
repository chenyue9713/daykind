import { describe, expect, it } from "vitest";

import { Deadline } from "../limits";
import { parseWorkoutFile } from "../parsers";
import { parseXml } from "../parsers/xml";
import { detectFormat, sanitizeFileName } from "../sniff";
import type { ParsedFile } from "../types";
import { buildActivityFit } from "./fit-builder";
import { loadFixture } from "./load-fixture";

function parse(name: string): ParsedFile {
  const result = parseWorkoutFile(loadFixture(name), name);
  if (!result.ok) throw new Error(`${name}: ${result.error.code} ${result.error.message}`);
  return result.file;
}

function parseError(name: string, bytes = loadFixture(name)) {
  const result = parseWorkoutFile(bytes, name);
  if (result.ok) throw new Error(`${name} unexpectedly parsed`);
  return result.error;
}

describe("FIT adapter", () => {
  it("reads an ordinary ride: sport, start, timer and elapsed seconds, meters, HR summary, device offset", () => {
    const file = parse("ride-ordinary.fit");
    expect(file.format).toBe("fit");
    expect(file.deviceLabel).toBe("Garmin device");
    expect(file.sessions).toHaveLength(1);
    const [s] = file.sessions;
    expect(s).toMatchObject({
      sport: "cycling",
      subSport: "road",
      startedAt: "2026-10-18T22:40:00.000Z",
      utcOffsetMinutes: -420,
      elapsedSeconds: 3480,
      elapsedSource: "device",
      timerSeconds: 3360,
      distanceMeters: 21500,
      heartRate: { avgBpm: 128, maxBpm: 161, basis: "device_summary", coverage: null },
      errors: [],
    });
  });

  it("never exposes the device serial number or GPS positions", () => {
    const file = parse("ride-ordinary.fit");
    const text = JSON.stringify(file);
    expect(text).not.toContain("3456789012");
    expect(text).not.toMatch(/lat|long|position/i);
    expect(file.sessions[0].providerId).toBe(`fit:1:3990:${Date.parse("2026-10-18T22:40:00Z") / 1000 - 631065600}:${Date.parse("2026-10-18T22:40:00Z") / 1000 - 631065600}`);
  });

  it("keeps pauses visible: timer time excludes the 20-minute stop", () => {
    const [s] = parse("ride-paused.fit").sessions;
    expect(s.elapsedSeconds).toBe(4200);
    expect(s.timerSeconds).toBe(3000);
    expect(s.distanceMeters).toBeCloseTo(17250.5, 2);
  });

  it("leaves heart rate unknown when the file has none", () => {
    const [s] = parse("walk-no-hr.fit").sessions;
    expect(s.heartRate).toEqual({ avgBpm: null, maxBpm: null, basis: "none", coverage: null });
  });

  it("reports every session of a multisport file, including big-endian messages", () => {
    const sessions = parse("multisport.fit").sessions;
    expect(sessions.map((s) => [s.sport, s.subSport, s.timerSeconds])).toEqual([
      ["walking", "generic", 1200],
      ["cycling", "indoor_cycling", 1800],
    ]);
  });

  it("time-weights heart-rate samples when the session has no summary", () => {
    const [s] = parse("walk-hr-samples-only.fit").sessions;
    expect(s.heartRate.basis).toBe("time_weighted_samples");
    expect(s.heartRate.avgBpm).toBe(120);
    expect(s.heartRate.maxBpm).toBe(140);
    expect(s.heartRate.coverage).toBe(1);
  });

  it("does not present sparse samples as a workout average", () => {
    const [s] = parse("walk-sparse-hr.fit").sessions;
    expect(s.heartRate.avgBpm).toBeNull();
    expect(s.heartRate.maxBpm).toBe(150);
    expect(s.heartRate.coverage).toBeLessThan(0.2);
  });

  it("decodes compressed-timestamp records", () => {
    const [s] = parse("walk-compressed-timestamps.fit").sessions;
    expect(s.heartRate.basis).toBe("time_weighted_samples");
    expect(s.heartRate.avgBpm).toBe(100);
    expect(s.heartRate.coverage).toBe(1);
  });

  it("records no offset when the file has no activity message", () => {
    expect(parse("walk-no-offset.fit").sessions[0].utcOffsetMinutes).toBeNull();
    expect(parse("walk-travel-offset.fit").sessions[0].utcOffsetMinutes).toBe(540);
  });

  it("accepts timer time without elapsed time", () => {
    const [s] = parse("walk-timer-only.fit").sessions;
    expect(s.elapsedSeconds).toBeNull();
    expect(s.timerSeconds).toBe(1500);
    expect(s.errors).toEqual([]);
  });

  it.each([
    ["corrupt-checksum.fit", "corrupt"],
    ["truncated.fit", "corrupt"],
    ["zip-renamed.fit", "archive"],
    ["course.fit", "not_an_activity"],
    ["no-sessions.fit", "no_sessions"],
  ])("rejects %s with %s", (name, code) => {
    const error = parseError(name);
    expect(error.code).toBe(code);
    expect(error.message.length).toBeGreaterThan(20);
  });

  it("rejects random bytes named .fit", () => {
    const bytes = new Uint8Array(64).map((_, i) => (i * 37) % 251);
    expect(parseError("random.fit", bytes).code).toBe("unsupported_content");
  });

  it("stops a long decode when the time budget runs out", () => {
    const records = Array.from({ length: 9000 }, (_, t) => ({ t, hr: 100 }));
    const bytes = buildActivityFit({
      sessions: [{ start: "2026-10-18T10:00:00Z", elapsed: 9000, timer: 9000, distance: null, sport: 11, subSport: 0, avgHr: null, maxHr: null }],
      records,
    });
    expect(parseWorkoutFile(bytes, "long.fit").ok).toBe(true);
    const result = parseWorkoutFile(bytes, "long.fit", { deadline: new Deadline(-1) });
    expect(result.ok ? null : result.error.code).toBe("timeout");
  });
});

describe("TCX adapter", () => {
  it("reads a Garmin walk: lap timer total, derived elapsed, lap-weighted HR, creator", () => {
    const file = parse("walk-ordinary.tcx");
    expect(file.format).toBe("tcx");
    expect(file.deviceLabel).toBe("Forerunner 255");
    const [s] = file.sessions;
    expect(s).toMatchObject({
      sport: "Running",
      startedAt: "2026-10-19T01:05:00.000Z",
      startIsFloating: false,
      utcOffsetMinutes: null,
      timerSeconds: 1500,
      elapsedSeconds: 1500,
      elapsedSource: "derived",
      distanceMeters: 2020,
      providerId: "tcx:2026-10-19T01:05:00Z",
    });
    // (102 × 720 + 108 × 780) / 1500 = 105.1
    expect(s.heartRate).toEqual({ avgBpm: 105, maxBpm: 121, basis: "device_summary", coverage: 1 });
    expect(JSON.stringify(file)).not.toMatch(/37\.77|122\.42|stroller|3456789012/);
  });

  it("keeps a pause visible: elapsed from trackpoints exceeds lap timer time", () => {
    const [s] = parse("walk-paused.tcx").sessions;
    expect(s.timerSeconds).toBe(1800);
    expect(s.elapsedSeconds).toBe(2400);
  });

  it("leaves heart rate unknown when no HR is recorded", () => {
    expect(parse("ride-no-hr.tcx").sessions[0].heartRate.basis).toBe("none");
  });

  it("reports each activity in a multi-activity file", () => {
    const sessions = parse("multi-activity.tcx").sessions;
    expect(sessions.map((s) => s.sport)).toEqual(["Biking", "Other"]);
    expect(sessions[1].distanceMeters).toBeNull();
    expect(sessions[1].timerSeconds).toBe(1200);
  });

  it("flags times without a timezone as floating", () => {
    const [s] = parse("floating-time.tcx").sessions;
    expect(s.startIsFloating).toBe(true);
    expect(s.startedAt).toBe("2026-10-14T07:30:00.000Z");
  });

  it("time-weights trackpoint heart rate when laps have no summary", () => {
    const [s] = parse("ride-hr-samples-only.tcx").sessions;
    expect(s.heartRate).toMatchObject({ basis: "time_weighted_samples", avgBpm: 120, maxBpm: 140, coverage: 1 });
  });

  it("fails only the session without a start time", () => {
    const sessions = parse("missing-start.tcx").sessions;
    expect(sessions[0].errors).toContain("No start time was recorded for this session.");
    expect(sessions[1].errors).toEqual([]);
  });

  it.each([
    ["xxe.tcx", "xml_dtd_forbidden"],
    ["billion-laughs.tcx", "xml_dtd_forbidden"],
    ["too-deep.tcx", "too_complex"],
    ["truncated.tcx", "corrupt"],
    ["not-xml.tcx", "unsupported_content"],
    ["other-xml.tcx", "unsupported_content"],
    ["course.tcx", "not_an_activity"],
  ])("rejects %s with %s", (name, code) => {
    expect(parseError(name).code).toBe(code);
  });

  it("never resolves external entities, even without a DOCTYPE", () => {
    const xml = new TextEncoder().encode(
      `<?xml version="1.0"?><TrainingCenterDatabase><Activities><Activity Sport="Biking"><Id>&xxe;</Id></Activity></Activities></TrainingCenterDatabase>`,
    );
    expect(parseError("x.tcx", xml).code).toBe("corrupt");
  });

  it("stops a long parse when the time budget runs out", () => {
    const body = "<Lap><TotalTimeSeconds>1</TotalTimeSeconds></Lap>".repeat(5000);
    const xml = new TextEncoder().encode(
      `<TrainingCenterDatabase><Activities><Activity Sport="Biking"><Id>2026-10-18T10:00:00Z</Id>${body}</Activity></Activities></TrainingCenterDatabase>`,
    );
    const result = parseWorkoutFile(xml, "long.tcx", { deadline: new Deadline(-1) });
    expect(result.ok ? null : result.error.code).toBe("timeout");
  });

  it("rejects UTF-16 and invalid UTF-8", () => {
    expect(parseError("a.tcx", Uint8Array.from([0xff, 0xfe, 0x3c, 0x00])).code).toBe("unsupported_content");
    expect(parseError("b.tcx", Uint8Array.from([0x3c, 0x61, 0xc3, 0x28, 0x3e])).code).toBe("corrupt");
  });
});

describe("XML tokenizer", () => {
  const collect = (xml: string) => {
    const events: string[] = [];
    parseXml(xml, {
      open: (name, attrs) => events.push(`<${name}${Object.keys(attrs).length ? JSON.stringify(attrs) : ""}>`),
      close: (name) => events.push(`</${name}>`),
      text: (value) => value.trim() && events.push(value),
    });
    return events;
  };

  it("strips namespace prefixes, decodes predefined and numeric entities, reads CDATA", () => {
    expect(collect(`<?xml version="1.0"?><!-- c --><ns:a x="1 &gt; 0"><b>&amp;&#65;&#x42;</b><![CDATA[<raw>]]><c/></ns:a>`)).toEqual([
      '<a{"x":"1 > 0"}>',
      "<b>",
      "&AB",
      "</b>",
      "<raw>",
      "<c>",
      "</c>",
      "</a>",
    ]);
  });

  it("rejects mismatched tags, text outside the root, and a second root", () => {
    expect(() => collect("<a></b>")).toThrow();
    expect(() => collect("x<a/>")).toThrow();
    expect(() => collect("<a/><b/>")).toThrow();
  });
});

describe("content detection", () => {
  it("decides by content, not extension", () => {
    expect(detectFormat(loadFixture("ride-ordinary.fit"), "ride.tcx")).toBe("fit");
    expect(detectFormat(loadFixture("walk-ordinary.tcx"), "walk.fit")).toBe("tcx");
  });

  it("rejects other extensions, empty, oversized, and images", () => {
    expect(() => detectFormat(loadFixture("ride-ordinary.fit"), "ride.gpx")).toThrow(/\.fit or \.tcx/);
    expect(() => detectFormat(new Uint8Array(), "a.fit")).toThrow(/empty/);
    expect(() => detectFormat(new Uint8Array(20 * 1024 * 1024 + 1), "a.fit")).toThrow(/20 MB/);
    expect(() => detectFormat(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]), "a.fit")).toThrow(/PNG/);
  });

  it("sanitizes untrusted filenames", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("C:\\Users\\me\\walk.fit")).toBe("walk.fit");
    expect(sanitizeFileName("ride\u202egnp.fit")).toBe("ridegnp.fit");
    expect(sanitizeFileName("   ")).toBeNull();
    expect(sanitizeFileName(`${"a".repeat(300)}.fit`)!.length).toBeLessThanOrEqual(120);
  });
});
