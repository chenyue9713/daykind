"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

import { isValidTimezone, sameTimezone } from "@/lib/domain/preferences";

const subscribeNever = () => () => {};

/**
 * The timezone this browser reports, or null during server rendering. It is
 * only ever offered as a suggestion; nothing changes until the user saves.
 */
export function useBrowserTimezone(): string | null {
  return useSyncExternalStore(
    subscribeNever,
    () => {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return isValidTimezone(zone) ? zone : null;
    },
    () => null,
  );
}

/**
 * Travel prompt: when this device reports a different timezone from the
 * confirmed one, say which one DayKind is using. It never changes it; the
 * user decides in Settings.
 */
export function TimezoneCheck({ timezone }: { timezone: string }) {
  const browser = useBrowserTimezone();
  if (!browser || sameTimezone(browser, timezone)) return null;
  return (
    <p className="notice small" role="note">
      This device is set to {browser.replaceAll("_", " ")}, but DayKind is using {timezone.replaceAll("_", " ")} for
      dates and weeks. If you&apos;ve moved or are travelling, you can <Link href="/settings#prefs-heading">change it in Settings</Link>.
      Entries you already saved keep their dates.
    </p>
  );
}
