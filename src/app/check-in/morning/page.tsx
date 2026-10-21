import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader, PageSkeleton } from "@/components/ui";
import { formatLocalDate } from "@/lib/domain/dates";
import { loadMorningCheckIn } from "@/lib/views/loaders";
import { MorningForm } from "./morning-form";

export const metadata: Metadata = { title: "Morning check-in" };

export default function MorningPage() {
  return (
    <>
      <PageHeader title="Morning check-in" description="About a minute. “Unknown” is always a valid answer." />
      <Suspense fallback={<PageSkeleton blocks={4} />}>
        <MorningContent />
      </Suspense>
    </>
  );
}

async function MorningContent() {
  const { today, existing, lastSymptom, isSample } = await loadMorningCheckIn();
  return (
    <div className="stack">
      {existing ? (
        <p className="notice notice-info small">
          {isSample ? "A sample" : "A"} check-in for {formatLocalDate(existing.wakingDate)} already exists. Changes
          update that entry instead of adding another.
        </p>
      ) : null}
      {lastSymptom ? (
        <p className="notice small">
          Your last ankle entry was on {formatLocalDate(lastSymptom.localDate)}
          {lastSymptom.anklePain !== null ? ` (pain ${lastSymptom.anklePain}/10)` : ""}. It isn&apos;t treated as
          current — update it below if you can.
        </p>
      ) : null}
      <MorningForm today={today} existing={existing} />
    </div>
  );
}
