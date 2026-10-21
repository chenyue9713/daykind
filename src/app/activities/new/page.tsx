import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader, PageSkeleton } from "@/components/ui";
import { loadNewActivityForm } from "@/lib/views/loaders";
import { ActivityForm } from "../activity-form";

export const metadata: Metadata = { title: "Add activity" };

export default function NewActivityPage({ searchParams }: PageProps<"/activities/new">) {
  return (
    <>
      <PageHeader title="Add activity" description="Log a walk, ride, or resistance session at any time." />
      <Suspense fallback={<PageSkeleton blocks={2} />}>
        <NewActivityContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function NewActivityContent({ searchParams }: Pick<PageProps<"/activities/new">, "searchParams">) {
  const { date } = await searchParams;
  const form = await loadNewActivityForm(typeof date === "string" ? date : undefined);
  return <ActivityForm {...form} />;
}
