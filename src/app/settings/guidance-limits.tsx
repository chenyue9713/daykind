/**
 * What the guidance is and is not. Shown during first-use setup, where it must
 * be acknowledged, and in Settings. The wording is a draft pending review; it
 * must not be presented as clinically approved.
 */
export function GuidanceLimits({ ruleVersion }: { ruleVersion: string }) {
  return (
    <div className="stack-sm small">
      <p>
        DayKind&apos;s daily suggestions come from fixed, explainable rules applied to what you record (rule set{" "}
        {ruleVersion}). They are general information, not medical advice.
      </p>
      <ul>
        <li>They are not a diagnosis, a medical readiness score, or a treatment plan.</li>
        <li>
          The wording and thresholds, such as the six-hour sleep flag, are draft proposals. They have not been
          reviewed or approved by a clinician.
        </li>
        <li>They don&apos;t replace your healthcare professional&apos;s advice or your existing care plan.</li>
        <li>
          Sudden joint pain with swelling, a fever, or feeling unwell needs prompt medical assessment. Stop an
          activity if symptoms get worse.
        </li>
        <li>Suggestions depend on what you record. Missing or out-of-date entries limit them.</li>
      </ul>
    </div>
  );
}
