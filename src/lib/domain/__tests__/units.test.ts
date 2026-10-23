import { describe, expect, it } from "vitest";

import {
  distanceFromMeters,
  formatDistance,
  formatWeight,
  kgFromWeight,
  metersFromDistance,
  weightFromKg,
} from "../units";

describe("distance units", () => {
  it("converts miles and kilometers to meters and back", () => {
    expect(metersFromDistance(1, "mi")).toBe(1609.34);
    expect(metersFromDistance(5, "km")).toBe(5000);
    expect(distanceFromMeters(21500, "km")).toBe(21.5);
    expect(distanceFromMeters(metersFromDistance(3.1, "mi"), "mi")).toBeCloseTo(3.1, 4);
  });

  it("displays stored meters in the chosen unit, keeping unknown distinct", () => {
    expect(formatDistance(21500, "km")).toBe("21.50 km");
    expect(formatDistance(21500, "mi")).toBe("13.36 mi");
    expect(formatDistance(null, "mi")).toBe("Not recorded");
  });
});

describe("weight units (AC15)", () => {
  it("round-trips kg and lb within display precision", () => {
    for (const lb of [120, 180.4, 250]) {
      expect(formatWeight(kgFromWeight(lb, "lb"), "lb")).toBe(`${lb.toFixed(1)} lb`);
    }
    expect(weightFromKg(kgFromWeight(81.6, "kg"), "kg")).toBe(81.6);
    expect(formatWeight(80, "kg")).toBe("80.0 kg");
    expect(formatWeight(80, "lb")).toBe("176.4 lb");
  });
});
