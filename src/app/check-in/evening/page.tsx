import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader, PageSkeleton } from "@/components/ui";
import { formatLocalDate, formatTime } from "@/lib/domain/dates";
import { activityTypeLabel, durationBasisLabel, formatDuration, intensityLabel } from "@/lib/domain/format";
import { goalSeconds } from "@/lib/domain/targets";
import { loadEveningCheckIn } from "@/lib/views/loaders";
import { EveningForm, type ExistingActivityView } from "./evening-form";

export const metadata: Metadata = { title: "Evening check-in" };

export default function EveningPage({ searchParams }: PageProps<"/check-in/evening">) {
  return (
    <>
      <PageHeader
        title="Evening check-in"
        description="Review today's activity, then note your ankle and how tired you feel."
      />
      <Suspense fallback={<PageSkeleton blocks={4} />}>
        <EveningContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function EveningContent({ searchParams }: Pick<PageProps<"/check-in/evening">, "searchParams">) {
  const { date: requested } = await searchParams;
  const { today, date, activities, existing, symptom } = await loadEveningCheckIn(
    typeof requested === "string" ? requested : undefined,
  );
  const views: ExistingActivityView[] = activities.map((a) => {
    const { seconds, basis } = goalSeconds(a);
    return {
      id: a.id,
      title: activityTypeLabel[a.type],
      detail: `${formatTime(a.startedAt, a.timezone)} · ${formatDuration(seconds)} ${durationBasisLabel[basis]} · ${
        intensityLabel[a.intensity]
      }`,
      isSample: a.source === "sample",
    };
  });

  return (
    <div className="stack">
      <p className="muted">{formatLocalDate(date, "long")}</p>
      {date !== today ? (
        <p className="notice small">
          Editing an earlier day. <Link href="/check-in/evening">Go to today</Link>
        </p>
      ) : null}
      {existing ? (
        <p className="notice notice-info small">
          This day&apos;s evening check-in is already saved. Changes update it; activities already listed are not
          added again.
        </p>
      ) : null}
      <EveningForm key={date} date={date} existingActivities={views} existing={existing} symptom={symptom} />
    </div>
  );
}
