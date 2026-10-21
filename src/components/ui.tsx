import type { ReactNode } from "react";

export function PageHeader({ title, description, aside }: { title: string; description?: ReactNode; aside?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>{title}</h1>
        {aside}
      </div>
      {description ? <p>{description}</p> : null}
    </header>
  );
}

export function SampleBanner() {
  return (
    <div className="sample-banner" role="note">
      <strong>Sample data.</strong>
      <span>
        Everything shown is invented for this review and is not anyone&apos;s real record. Nothing you enter is
        saved yet.
      </span>
    </div>
  );
}

export function SampleBadge() {
  return <span className="badge badge-sample">Sample</span>;
}

export function LaterBadge({ children = "Not available yet" }: { children?: ReactNode }) {
  return <span className="badge badge-later">{children}</span>;
}

export function Skeleton({ height = 120 }: { height?: number }) {
  return <div className="skeleton" style={{ height }} />;
}

export function PageSkeleton({ blocks = 3 }: { blocks?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-live="polite">
      <span className="visually-hidden">Loading…</span>
      {Array.from({ length: blocks }, (_, i) => (
        <Skeleton key={i} height={i === 0 ? 140 : 110} />
      ))}
    </div>
  );
}

export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div
      className="meter"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
    >
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}
