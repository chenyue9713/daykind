import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader, PageSkeleton } from "@/components/ui";
import { formatLocalDate } from "@/lib/domain/dates";
import { loadMorningCheckIn } from "@/lib/views/loaders";
import { MorningForm } from "./morning-form";

export const metadata: Metadata = { title: "Morning check-in" };

export default function MorningPage({ searchParams }: PageProps<"/check-in/morning">) {
  return (
    <>
      <PageHeader title="Morning check-in" description="About a minute. “Unknown” is always a valid answer." />
      <Suspense fallback={<PageSkeleton blocks={4} />}>
        <MorningContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function MorningContent({ searchParams }: Pick<PageProps<"/check-in/morning">, "searchParams">) {
  const { date: requested } = await searchParams;
  const { today, date, existing, symptom, lastSymptom, isSample } = await loadMorningCheckIn(
    typeof requested === "string" ? requested : undefined,
  );
  return (
    <div className="stack">
      {date !== today ? (
        <p className="notice small">
          Editing the check-in for {formatLocalDate(date, "long")}. <Link href="/check-in/morning">Go to today</Link>
        </p>
      ) : null}
      {existing ? (
        <p className="notice notice-info small">
          {isSample ? "A sample" : "A"} check-in for {formatLocalDate(existing.wakingDate)} already exists. Changes
          update that entry instead of adding another.
        </p>
      ) : null}
      {lastSymptom && !symptom ? (
        <p className="notice small">
          Your last ankle entry was on {formatLocalDate(lastSymptom.localDate)}
          {lastSymptom.anklePain !== null ? ` (pain ${lastSymptom.anklePain}/10)` : ""}. It isn&apos;t treated as
          current — update it below if you can.
        </p>
      ) : null}
      {/* Remount only when the date changes, so a save keeps its confirmation message. */}
      <MorningForm key={date} date={date} today={today} existing={existing} symptom={symptom} />
    </div>
  );
}
