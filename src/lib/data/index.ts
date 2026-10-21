import "server-only";

import { cache } from "react";

import { getCurrentUser } from "@/lib/auth/session";
import type { DayKindRepository } from "./repository";
import { createSampleRepository } from "./sample/sample-repository";

export type { DayKindRepository, SaveResult } from "./repository";

function configuredSource(): string {
  return process.env.DAYKIND_DATA_SOURCE || "sample";
}

/** True when the app is configured to show generated sample data. */
export function isSampleMode(): boolean {
  return configuredSource() === "sample";
}

/**
 * Returns the repository for the signed-in user, memoized per request. The
 * data source is chosen by DAYKIND_DATA_SOURCE; only "sample" exists today.
 */
export const getRepository = cache(async (): Promise<DayKindRepository> => {
  const user = await getCurrentUser();
  const source = configuredSource();

  switch (source) {
    case "sample":
      return createSampleRepository({
        userId: user.id,
        timezone: process.env.DAYKIND_SAMPLE_TIMEZONE || "America/Los_Angeles",
      });
    default:
      throw new Error(
        `DAYKIND_DATA_SOURCE="${source}" is not supported yet. Use "sample" until database storage is added.`,
      );
  }
});
