import "server-only";

import { cache } from "react";

import { getCurrentUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DayKindRepository } from "./repository";
import { createSampleRepository } from "./sample/sample-repository";
import { createSupabaseRepository } from "./supabase/supabase-repository";

export type * from "./repository";

function configuredSource(): string {
  return process.env.DAYKIND_DATA_SOURCE || "sample";
}

/** True when the app is configured to show generated sample data. */
export function isSampleMode(): boolean {
  return configuredSource() === "sample";
}

/**
 * Returns the repository for the signed-in user, memoized per request. The
 * data source is chosen by DAYKIND_DATA_SOURCE: "sample" (read-only invented
 * data, no sign-in) or "supabase" (signed-in, stored data).
 */
export const getRepository = cache(async (): Promise<DayKindRepository> => {
  const source = configuredSource();
  const user = await getCurrentUser();

  switch (source) {
    case "sample":
      return createSampleRepository({
        userId: user.id,
        timezone: process.env.DAYKIND_SAMPLE_TIMEZONE || "America/Los_Angeles",
      });
    case "supabase":
      return createSupabaseRepository({ client: await createSupabaseServerClient(), userId: user.id });
    default:
      throw new Error(`DAYKIND_DATA_SOURCE="${source}" is not supported. Use "sample" or "supabase".`);
  }
});
