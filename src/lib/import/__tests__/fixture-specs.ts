// Representative workout files. These are synthetic, Garmin-shaped fixtures,
// not exports from the user's own devices. Regenerate with:
//   UPDATE_FIXTURES=1 npx vitest run src/lib/import/__tests__/fixtures.test.ts
import { buildActivityFit, FitBuilder, T, type RecordSpec } from "./fit-builder";

const SPORT = { generic: 0, running: 1, cycling: 2, training: 10, walking: 11 } as const;
const SUB = { generic: 0, road: 7, indoorCycling: 6, strength: 20 } as const;
const PDT = -7 * 60;

function steadyRecords(seconds: number, every: number, hr: (t: number) => number | null, gap?: [from: number, to: number]): RecordSpec[] {
  const out: RecordSpec[] = [];
  for (let t = 0; t <= seconds; t += every) {
    if (gap && t > gap[0] && t < gap[1]) continue;
    out.push({ t, hr: hr(t) });
  }
  return out;
}

function corruptCopy(bytes: Uint8Array, at: number): Uint8Array {
  const copy = Uint8Array.from(bytes);
  copy[at] ^= 0xff;
  return copy;
}

export function fitFixtures(): Record<string, Uint8Array> {
  const ride = buildActivityFit({
    // 15:40 PDT on Sun Oct 18 2026; 58 min elapsed, 56 min timer.
    sessions: [{ start: "2026-10-18T22:40:00Z", elapsed: 3480, timer: 3360, distance: 21500, sport: SPORT.cycling, subSport: SUB.road, avgHr: 128, maxHr: 161 }],
    records: steadyRecords(3480, 10, (t) => 110 + Math.round((t / 3480) * 40)),
    localOffsetMinutes: PDT,
  });

  const paused = buildActivityFit({
    // 70 min elapsed with a 20-minute stop: 50 min timer.
    sessions: [{ start: "2026-10-17T16:05:00Z", elapsed: 4200, timer: 3000, distance: 17250.5, sport: SPORT.cycling, subSport: SUB.road, avgHr: 121, maxHr: 150 }],
    records: steadyRecords(4200, 10, () => 121, [1500, 2700]),
    localOffsetMinutes: PDT,
  });

  const walkNoHr = buildActivityFit({
    sessions: [{ start: "2026-10-16T19:12:00Z", elapsed: 1500, timer: 1440, distance: 1900, sport: SPORT.walking, subSport: SUB.generic, avgHr: null, maxHr: null }],
    records: steadyRecords(1500, 15, () => null),
    localOffsetMinutes: PDT,
  });

  const strength = buildActivityFit({
    sessions: [{ start: "2026-10-15T01:30:00Z", elapsed: 2400, timer: 2100, distance: 0, sport: SPORT.training, subSport: SUB.strength, avgHr: 102, maxHr: 139 }],
    localOffsetMinutes: PDT,
  });

  const multisport = buildActivityFit({
    sessions: [
      { start: "2026-10-14T15:00:00Z", elapsed: 1260, timer: 1200, distance: 1600, sport: SPORT.walking, subSport: SUB.generic, avgHr: 98, maxHr: 115 },
      { start: "2026-10-14T15:25:00Z", elapsed: 1860, timer: 1800, distance: 9800, sport: SPORT.cycling, subSport: SUB.indoorCycling, avgHr: 131, maxHr: 158 },
    ],
    localOffsetMinutes: PDT,
    bigEndianSessions: true,
  });

  const generic = buildActivityFit({
    sessions: [{ start: "2026-10-13T17:00:00Z", elapsed: 1800, timer: 1800, distance: null, sport: SPORT.generic, subSport: SUB.generic, avgHr: 95, maxHr: 120 }],
    localOffsetMinutes: PDT,
  });

  const hrSamplesOnly = buildActivityFit({
    // No HR summary in the session; records every 5 s at 100 bpm then 140 bpm.
    sessions: [{ start: "2026-10-12T18:00:00Z", elapsed: 1200, timer: 1200, distance: 1500, sport: SPORT.walking, subSport: SUB.generic, avgHr: null, maxHr: null }],
    records: steadyRecords(1200, 5, (t) => (t < 600 ? 100 : 140)),
    localOffsetMinutes: PDT,
  });

  const sparseHr = buildActivityFit({
    // HR only every 2 minutes: coverage too low to show an average.
    sessions: [{ start: "2026-10-11T18:00:00Z", elapsed: 1800, timer: 1800, distance: 2200, sport: SPORT.walking, subSport: SUB.generic, avgHr: null, maxHr: null }],
    records: steadyRecords(1800, 120, () => 150),
    localOffsetMinutes: PDT,
  });

  const travel = buildActivityFit({
    // 09:30 Oct 18 in Los Angeles, but 01:30 Oct 19 on a watch set to Tokyo (UTC+9).
    sessions: [{ start: "2026-10-18T16:30:00Z", elapsed: 1800, timer: 1750, distance: 2400, sport: SPORT.walking, subSport: SUB.generic, avgHr: 99, maxHr: 118 }],
    localOffsetMinutes: 9 * 60,
  });

  const compressed = buildActivityFit({
    sessions: [{ start: "2026-10-12T22:00:00Z", elapsed: 600, timer: 600, distance: 800, sport: SPORT.walking, subSport: SUB.generic, avgHr: null, maxHr: null }],
    records: steadyRecords(600, 4, (t) => (t < 300 ? 90 : 110)),
    localOffsetMinutes: PDT,
    compressTimestamps: true,
  });

  const noOffset = buildActivityFit({
    sessions: [{ start: "2026-10-10T20:00:00Z", elapsed: 900, timer: 900, distance: 1200, sport: SPORT.walking, subSport: SUB.generic, avgHr: 97, maxHr: 109 }],
  });

  const timerOnly = buildActivityFit({
    sessions: [{ start: "2026-10-09T20:00:00Z", elapsed: null, timer: 1500, distance: null, sport: SPORT.walking, subSport: SUB.generic, avgHr: null, maxHr: null }],
    localOffsetMinutes: PDT,
  });

  const course = buildActivityFit({
    sessions: [{ start: "2026-10-08T20:00:00Z", elapsed: 900, timer: 900, distance: 1200, sport: SPORT.cycling, subSport: SUB.road, avgHr: null, maxHr: null }],
    fileType: 6,
  });

  const noSessions = new FitBuilder()
    .define(0, 0, [[0, T.enum], [1, T.uint16]])
    .data(0, [4, 1])
    .build();

  return {
    "ride-ordinary.fit": ride,
    "ride-paused.fit": paused,
    "walk-no-hr.fit": walkNoHr,
    "strength.fit": strength,
    "multisport.fit": multisport,
    "generic-sport.fit": generic,
    "walk-hr-samples-only.fit": hrSamplesOnly,
    "walk-sparse-hr.fit": sparseHr,
    "walk-travel-offset.fit": travel,
    "walk-compressed-timestamps.fit": compressed,
    "walk-no-offset.fit": noOffset,
    "walk-timer-only.fit": timerOnly,
    "course.fit": course,
    "no-sessions.fit": noSessions,
    "corrupt-checksum.fit": corruptCopy(ride, 200),
    "truncated.fit": ride.slice(0, Math.floor(ride.length / 2)),
    "zip-renamed.fit": Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00, ...new Array(40).fill(0)]),
  };
}

// ---------- TCX ----------

const NS = `xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"`;

interface TcxLapSpec {
  start: string;
  total: number;
  distance: number | null;
  avgHr?: number;
  maxHr?: number;
  points: { at: string; hr?: number; distance?: number }[];
}

function tcxActivity(sport: string, id: string, laps: TcxLapSpec[], creator = "Forerunner 255"): string {
  const lapXml = laps
    .map(
      (l) => `      <Lap StartTime="${l.start}">
        <TotalTimeSeconds>${l.total}</TotalTimeSeconds>
${l.distance !== null ? `        <DistanceMeters>${l.distance}</DistanceMeters>\n` : ""}        <Calories>80</Calories>
${l.avgHr !== undefined ? `        <AverageHeartRateBpm><Value>${l.avgHr}</Value></AverageHeartRateBpm>\n` : ""}${l.maxHr !== undefined ? `        <MaximumHeartRateBpm><Value>${l.maxHr}</Value></MaximumHeartRateBpm>\n` : ""}        <Intensity>Active</Intensity>
        <TriggerMethod>Manual</TriggerMethod>
        <Track>
${l.points
  .map(
    (p, i) => `          <Trackpoint>
            <Time>${p.at}</Time>
            <Position><LatitudeDegrees>${(37.77 + i * 1e-4).toFixed(6)}</LatitudeDegrees><LongitudeDegrees>${(-122.42 + i * 1e-4).toFixed(6)}</LongitudeDegrees></Position>
            <AltitudeMeters>12.4</AltitudeMeters>
${p.distance !== undefined ? `            <DistanceMeters>${p.distance}</DistanceMeters>\n` : ""}${p.hr !== undefined ? `            <HeartRateBpm><Value>${p.hr}</Value></HeartRateBpm>\n` : ""}            <Extensions><ns3:TPX><ns3:Speed>1.3</ns3:Speed></ns3:TPX></Extensions>
          </Trackpoint>`,
  )
  .join("\n")}
        </Track>
      </Lap>`,
    )
    .join("\n");
  return `    <Activity Sport="${sport}">
      <Id>${id}</Id>
${lapXml}
      <Notes>Morning &amp; stroller &lt;3</Notes>
      <Creator xsi:type="Device_t">
        <Name>${creator}</Name>
        <UnitId>3456789012</UnitId>
        <ProductID>3990</ProductID>
      </Creator>
    </Activity>`;
}

const tcxDoc = (activities: string[]) => `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase ${NS}>
  <Activities>
${activities.join("\n")}
  </Activities>
  <Author xsi:type="Application_t"><Name>Garmin Connect</Name></Author>
</TrainingCenterDatabase>
`;

function points(startIso: string, seconds: number, every: number, opts: { hr?: (t: number) => number | undefined; skip?: [number, number]; meters?: number } = {}) {
  const start = Date.parse(startIso);
  const out: TcxLapSpec["points"] = [];
  for (let t = 0; t <= seconds; t += every) {
    if (opts.skip && t > opts.skip[0] && t < opts.skip[1]) continue;
    out.push({
      at: new Date(start + t * 1000).toISOString().replace(".000Z", "Z"),
      hr: opts.hr?.(t),
      distance: opts.meters !== undefined ? Math.round((opts.meters * t) / seconds) : undefined,
    });
  }
  return out;
}

export function tcxFixtures(): Record<string, string> {
  // Walk exported by Garmin Connect as Sport="Running": two laps, 25 min, HR per lap.
  const walk = tcxDoc([
    tcxActivity("Running", "2026-10-19T01:05:00Z", [
      { start: "2026-10-19T01:05:00Z", total: 720, distance: 980, avgHr: 102, maxHr: 118, points: points("2026-10-19T01:05:00Z", 720, 30, { hr: () => 102, meters: 980 }) },
      { start: "2026-10-19T01:17:00Z", total: 780, distance: 1040, avgHr: 108, maxHr: 121, points: points("2026-10-19T01:17:00Z", 780, 30, { hr: () => 108, meters: 1040 }) },
    ]),
  ]);

  const rideNoHr = tcxDoc([
    tcxActivity("Biking", "2026-10-17T23:10:00Z", [
      { start: "2026-10-17T23:10:00Z", total: 2100, distance: 12400, points: points("2026-10-17T23:10:00Z", 2100, 60, { meters: 12400 }) },
    ], "Edge 530"),
  ]);

  // 30 min timer with a 10-minute pause in the middle: 40 min elapsed.
  const pausedWalk = tcxDoc([
    tcxActivity("Other", "2026-10-16T16:00:00Z", [
      { start: "2026-10-16T16:00:00Z", total: 1800, distance: 2300, avgHr: 104, maxHr: 119, points: points("2026-10-16T16:00:00Z", 2400, 30, { hr: () => 104, skip: [900, 1500], meters: 2300 }) },
    ]),
  ]);

  const multi = tcxDoc([
    tcxActivity("Biking", "2026-10-15T14:00:00Z", [
      { start: "2026-10-15T14:00:00Z", total: 1500, distance: 8000, avgHr: 125, maxHr: 149, points: points("2026-10-15T14:00:00Z", 1500, 60, { hr: () => 125 }) },
    ]),
    tcxActivity("Other", "2026-10-15T14:40:00Z", [
      { start: "2026-10-15T14:40:00Z", total: 1200, distance: null, avgHr: 99, maxHr: 121, points: [] },
    ]),
  ]);

  // Times without a timezone designator are ambiguous.
  const floating = tcxDoc([
    tcxActivity("Biking", "2026-10-14T07:30:00", [
      { start: "2026-10-14T07:30:00", total: 1800, distance: 9000, points: [] },
    ]),
  ]);

  // HR only in trackpoints (no lap summary): 100 bpm then 140 bpm, every 5 s.
  const hrSamples = tcxDoc([
    tcxActivity("Biking", "2026-10-13T15:00:00Z", [
      { start: "2026-10-13T15:00:00Z", total: 1200, distance: 6000, points: points("2026-10-13T15:00:00Z", 1200, 5, { hr: (t) => (t < 600 ? 100 : 140) }) },
    ]),
  ]);

  const missingStart = tcxDoc([
    `    <Activity Sport="Biking">
      <Lap><TotalTimeSeconds>600</TotalTimeSeconds></Lap>
    </Activity>`,
    tcxActivity("Biking", "2026-10-12T15:00:00Z", [
      { start: "2026-10-12T15:00:00Z", total: 900, distance: 5000, points: [] },
    ]),
  ]);

  const course = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase ${NS}>
  <Courses><Course><Name>Loop</Name></Course></Courses>
</TrainingCenterDatabase>
`;

  const xxe = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE TrainingCenterDatabase [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
<TrainingCenterDatabase ${NS}>
  <Activities><Activity Sport="Biking"><Id>&xxe;</Id></Activity></Activities>
</TrainingCenterDatabase>
`;

  const laughs = `<?xml version="1.0"?>
<!DOCTYPE lolz [
 <!ENTITY lol "lol">
 <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
 <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
]>
<TrainingCenterDatabase ${NS}><Activities><Activity Sport="Other"><Id>&lol3;</Id></Activity></Activities></TrainingCenterDatabase>
`;

  const deep = `<?xml version="1.0"?>\n<TrainingCenterDatabase ${NS}>${"<a>".repeat(200)}${"</a>".repeat(200)}</TrainingCenterDatabase>\n`;

  return {
    "walk-ordinary.tcx": walk,
    "ride-no-hr.tcx": rideNoHr,
    "walk-paused.tcx": pausedWalk,
    "multi-activity.tcx": multi,
    "floating-time.tcx": floating,
    "ride-hr-samples-only.tcx": hrSamples,
    "missing-start.tcx": missingStart,
    "course.tcx": course,
    "xxe.tcx": xxe,
    "billion-laughs.tcx": laughs,
    "too-deep.tcx": deep,
    "truncated.tcx": walk.slice(0, Math.floor(walk.length / 2)),
    "not-xml.tcx": "Activity,Date,Duration\nWalk,2026-10-18,25:00\n",
    "other-xml.tcx": `<?xml version="1.0"?>\n<gpx version="1.1"><trk><name>Walk</name></trk></gpx>\n`,
  };
}
