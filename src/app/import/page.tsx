import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader, PageSkeleton } from "@/components/ui";
import { getRepository } from "@/lib/data";
import { MAX_FILE_BYTES, MAX_FILE_LABEL } from "@/lib/import/limits";
import { ImportClient } from "./import-client";

export const metadata: Metadata = { title: "Import workout" };

export default function ImportPage() {
  return (
    <>
      <PageHeader
        title="Import a workout file"
        description="Add a Garmin TCX or FIT file. You'll see what was recognized before anything is saved."
      />
      <Suspense fallback={<PageSkeleton blocks={2} />}>
        <ImportContent />
      </Suspense>
    </>
  );
}

async function ImportContent() {
  const repo = await getRepository();
  const profile = await repo.getProfile();
  return (
    <ImportClient
      isSample={repo.isSample}
      timezone={profile.timezone}
      distanceUnit={profile.distanceUnit}
      maxBytes={MAX_FILE_BYTES}
      maxLabel={MAX_FILE_LABEL}
    />
  );
}
