import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader, PageSkeleton } from "@/components/ui";
import { formatLocalDate, formatTime } from "@/lib/domain/dates";
import { activityTypeLabel, formatDuration, intensityLabel } from "@/lib/domain/format";
import { goalSeconds } from "@/lib/domain/targets";
import { loadEveningCheckIn } from "@/lib/views/loaders";
import { EveningForm, type ExistingActivityView } from "./evening-form";

export const metadata: Metadata = { title: "Evening check-in" };

export default function EveningPage() {
  return (
    <>
      <PageHeader
        title="Evening check-in"
        description="Review today's activity, then note your ankle and how tired you feel."
      />
      <Suspense fallback={<PageSkeleton blocks={4} />}>
        <EveningContent />
      </Suspense>
    </>
  );
}

async function EveningContent() {
  const { today, profile, activities, existing } = await loadEveningCheckIn();
  const views: ExistingActivityView[] = activities.map((a) => {
    const { seconds, basis } = goalSeconds(a);
    return {
      id: a.id,
      title: activityTypeLabel[a.type],
      detail: `${formatTime(a.startedAt, profile.timezone)} · ${formatDuration(seconds)}${
        basis === "elapsed" ? " (elapsed time)" : ""
      } · ${intensityLabel[a.intensity]}`,
      isSample: a.source === "sample",
    };
  });

  return (
    <div className="stack">
      <p className="muted">{formatLocalDate(today, "long")}</p>
      <EveningForm today={today} existingActivities={views} existing={existing} />
    </div>
  );
}
