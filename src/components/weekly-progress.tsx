import { formatLocalDate, formatRange } from "@/lib/domain/dates";
import { formatDuration } from "@/lib/domain/format";
import type { WeeklyProgress } from "@/lib/domain/targets";
import type { LocalDate } from "@/lib/domain/types";
import { Meter } from "./ui";

const weekdayInitials = ["M", "T", "W", "T", "F", "S", "S"];

function dayState(day: WeeklyProgress["walkingDays"][number], today?: LocalDate) {
  if (today && day.date > today) return "future";
  if (day.qualified) return "qualified";
  if (day.seconds > 0) return "partial";
  if (day.unknown) return "unknown";
  return "none";
}

function dayDescription(day: WeeklyProgress["walkingDays"][number], today?: LocalDate) {
  const date = formatLocalDate(day.date);
  if (today && day.date > today) return `${date}: upcoming`;
  if (day.qualified) return `${date}: ${formatDuration(day.seconds)} walked, target met`;
  if (day.seconds > 0) return `${date}: ${formatDuration(day.seconds)} walked, under target`;
  if (day.unknown) return `${date}: not logged`;
  return `${date}: no walking recorded`;
}

export function WeeklyProgressCard({
  progress,
  today,
  title = "This week's targets",
  showSuppressedNote = false,
}: {
  progress: WeeklyProgress;
  today?: LocalDate;
  title?: string;
  showSuppressedNote?: boolean;
}) {
  const { goals } = progress;
  return (
    <section className="card stack" aria-labelledby="progress-heading">
      <div className="card-header" style={{ marginBottom: 0 }}>
        <h2 id="progress-heading">{title}</h2>
        <span className="small muted">{formatRange(progress.range)}</span>
      </div>

      {showSuppressedNote ? (
        <p className="notice small">Targets are shown for reference only. There is no catch-up today.</p>
      ) : null}

      <div className="stack-sm">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3>Walking</h3>
          <span className="small">
            {progress.walkingQualifiedDays} of 7 days with {formatDuration(goals.walkingSecondsPerDay)}+
          </span>
        </div>
        <ul className="week-strip" aria-label="Walking by day">
          {progress.walkingDays.map((day, i) => (
            <li key={day.date}>
              <span className="day-dot" data-state={dayState(day, today)} aria-hidden="true">
                {day.seconds > 0 ? Math.floor(day.seconds / 60) : day.unknown ? "?" : "–"}
              </span>
              <span aria-hidden="true">{weekdayInitials[i]}</span>
              <span className="visually-hidden">{dayDescription(day, today)}</span>
            </li>
          ))}
        </ul>
        <p className="small muted">Numbers are walking minutes. “?” means the day was not logged.</p>
      </div>

      <div className="stack-sm">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3>Resistance</h3>
          <span className="small">
            {progress.resistanceSessions} of {goals.resistanceSessionsPerWeek} sessions
          </span>
        </div>
        <Meter value={progress.resistanceSessions} max={goals.resistanceSessionsPerWeek} label="Resistance sessions" />
      </div>

      <div className="stack-sm">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3>Cycling</h3>
          <span className="small">
            {formatDuration(progress.cyclingSeconds)} of {formatDuration(goals.cyclingSecondsPerWeek)}
          </span>
        </div>
        <Meter value={progress.cyclingSeconds} max={goals.cyclingSecondsPerWeek} label="Cycling minutes" />
      </div>

      {progress.recoveryDays.length > 0 ? (
        <p className="small">
          Recovery days: {progress.recoveryDays.map((d) => formatLocalDate(d)).join(", ")}. Targets are unchanged.
        </p>
      ) : null}
    </section>
  );
}
