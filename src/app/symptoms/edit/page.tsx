import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageHeader, PageSkeleton } from "@/components/ui";
import { getSetUpRepository } from "@/lib/data";
import { formatLocalDate, formatTime } from "@/lib/domain/dates";
import { SymptomForm } from "../symptom-form";

export const metadata: Metadata = { title: "Edit ankle entry" };

export default function EditSymptomPage({ searchParams }: PageProps<"/symptoms/edit">) {
  return (
    <>
      <PageHeader title="Edit ankle entry" />
      <Suspense fallback={<PageSkeleton blocks={2} />}>
        <EditSymptomContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function EditSymptomContent({ searchParams }: Pick<PageProps<"/symptoms/edit">, "searchParams">) {
  const { id } = await searchParams;
  if (typeof id !== "string") notFound();
  const repo = await getSetUpRepository();
  const [existing, today, profile] = await Promise.all([repo.getSymptomEntry(id), repo.getToday(), repo.getProfile()]);
  if (!existing) notFound();
  return (
    <div className="stack">
      <p className="muted">
        Recorded {formatLocalDate(existing.localDate, "long")} at {formatTime(existing.observedAt, profile.timezone)}.
        Editing keeps that date and time.
      </p>
      <SymptomForm existing={existing} today={today} />
    </div>
  );
}
