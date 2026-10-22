import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader, PageSkeleton } from "@/components/ui";
import { getRepository } from "@/lib/data";
import { SymptomForm } from "../symptom-form";

export const metadata: Metadata = { title: "Ankle update" };

export default function NewSymptomPage() {
  return (
    <>
      <PageHeader title="Ankle update" description="Record how your ankle is right now, at any time of day." />
      <Suspense fallback={<PageSkeleton blocks={2} />}>
        <NewSymptomContent />
      </Suspense>
    </>
  );
}

async function NewSymptomContent() {
  const repo = await getRepository();
  return <SymptomForm existing={null} today={await repo.getToday()} />;
}
