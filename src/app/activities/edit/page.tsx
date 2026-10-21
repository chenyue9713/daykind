import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageHeader, PageSkeleton } from "@/components/ui";
import { formatLocalDate } from "@/lib/domain/dates";
import { loadEditActivityForm } from "@/lib/views/loaders";
import { ActivityForm } from "../activity-form";

export const metadata: Metadata = { title: "Edit activity" };

export default function EditActivityPage({ searchParams }: PageProps<"/activities/edit">) {
  return (
    <>
      <PageHeader title="Edit activity" />
      <Suspense fallback={<PageSkeleton blocks={2} />}>
        <EditActivityContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function EditActivityContent({ searchParams }: Pick<PageProps<"/activities/edit">, "searchParams">) {
  const { id } = await searchParams;
  if (typeof id !== "string") notFound();
  const view = await loadEditActivityForm(id);
  if (!view) notFound();
  return (
    <div className="stack">
      <p className="muted">{formatLocalDate(view.form.values.localDate, "long")}</p>
      {view.sourceNote ? <p className="small muted">{view.sourceNote}</p> : null}
      <ActivityForm {...view.form} />
    </div>
  );
}
