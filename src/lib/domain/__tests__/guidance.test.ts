import { describe, expect, it } from "vitest";

import { evaluateGuidance } from "../guidance";
import { evening, sleep, symptom } from "./fixtures";

const today = "2026-10-20";

describe("guidance rule precedence (AC10)", () => {
  it("gives recovery priority for an energetic morning with a reported flare", () => {
    const g = evaluateGuidance({ today, sleep: sleep(), evening: null, symptoms: [symptom({ flareReported: true })] });
    expect(g.category).toBe("recovery_priority");
    expect(g.suppressActivityPrompts).toBe(true);
  });

  it("suppresses strenuous suggestions when very tired", () => {
    const g = evaluateGuidance({
      today,
      sleep: sleep({ morningFatigue: "very_tired" }),
      evening: null,
      symptoms: [symptom()],
    });
    expect(g.category).toBe("recovery_priority");
  });

  it("raises a symptom warning even when other data are missing", () => {
    const g = evaluateGuidance({
      today,
      sleep: null,
      evening: null,
      symptoms: [symptom({ swellingHeatRedness: true, feverOrUnwell: true })],
    });
    expect(g.category).toBe("symptom_warning");
    expect(g.suppressActivityPrompts).toBe(true);
  });

  it("never gives an all-clear without current symptoms", () => {
    const yesterday = symptom({ localDate: "2026-10-19", observedAt: "2026-10-19T17:00:00.000Z" });
    const g = evaluateGuidance({ today, sleep: sleep(), evening: null, symptoms: [yesterday] });
    expect(g.category).toBe("incomplete");
    expect(g.staleSymptomNote).toContain("Oct 19");
  });

  it("uses the lower bound of a sleep range that spans six hours", () => {
    const g = evaluateGuidance({
      today,
      sleep: sleep({ durationMinSeconds: 5.5 * 3600, durationMaxSeconds: 6.5 * 3600, approximate: true }),
      evening: null,
      symptoms: [symptom()],
    });
    expect(g.category).toBe("lighter_day");
  });

  it("treats any ankle discomfort as a lighter day", () => {
    const g = evaluateGuidance({ today, sleep: sleep(), evening: null, symptoms: [symptom({ anklePain: 2 })] });
    expect(g.category).toBe("lighter_day");
  });

  it("allows the usual plan only with complete, symptom-free inputs", () => {
    const g = evaluateGuidance({ today, sleep: sleep(), evening: null, symptoms: [symptom()] });
    expect(g.category).toBe("ordinary_day");
  });

  it("uses evening fatigue once it is recorded", () => {
    const g = evaluateGuidance({
      today,
      sleep: sleep(),
      evening: evening({ localDate: today, eveningFatigue: "very_tired" }),
      symptoms: [symptom()],
    });
    expect(g.category).toBe("recovery_priority");
  });
});
