import { formatTime } from "@/lib/domain/dates";
import type { GuidanceCategory, GuidanceResult } from "@/lib/domain/guidance";

const categoryLabel: Record<GuidanceCategory, string> = {
  symptom_warning: "Symptom warning",
  recovery_priority: "Recovery priority",
  lighter_day: "Lighter day",
  ordinary_day: "Ordinary day",
  incomplete: "Limited information",
};

export function GuidanceCard({ guidance, timezone }: { guidance: GuidanceResult; timezone: string }) {
  return (
    <section className="card guidance stack-sm" data-category={guidance.category} aria-labelledby="guidance-heading">
      <span className="guidance-label">Today&apos;s suggestion · {categoryLabel[guidance.category]}</span>
      <h2 id="guidance-heading">{guidance.headline}</h2>
      <p>{guidance.message}</p>

      {guidance.reasons.length > 0 ? (
        <div>
          <h3 className="small">Why</h3>
          <ul className="small">
            {guidance.reasons.map((reason) => (
              <li key={reason.text}>
                {reason.text}
                {reason.recordedAt ? (
                  <span className="muted"> Recorded {formatTime(reason.recordedAt, timezone)}.</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {guidance.missing.length > 0 ? (
        <p className="small">
          <strong>Still missing:</strong> {guidance.missing.join(", ")}.
          {guidance.category !== "incomplete" && guidance.category !== "symptom_warning"
            ? " This suggestion may change once you add them."
            : null}
        </p>
      ) : null}

      {guidance.staleSymptomNote ? <p className="small">{guidance.staleSymptomNote}</p> : null}

      <p className="small muted">
        Rule set {guidance.ruleVersion} · draft wording, pending review · not medical advice
      </p>
    </section>
  );
}
