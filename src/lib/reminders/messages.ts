// Notification text. Deliberately generic: no health values, notes, or
// records, only which check-in is open and a link. Links point at pages that
// require sign-in; they carry no login token.
import { formatLocalDate } from "@/lib/domain/dates";
import type { ReminderKind, ReminderStage } from "@/lib/domain/reminders";
import type { LocalDate } from "@/lib/domain/types";

export interface ReminderMessageInput {
  kind: ReminderKind | "test";
  stage: ReminderStage;
  localDate: LocalDate;
  appUrl: string;
}

export interface ReminderMessage {
  subject: string;
  text: string;
  html: string;
  link: string;
}

const escapeHtml = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export function reminderMessage({ kind, stage, localDate, appUrl }: ReminderMessageInput): ReminderMessage {
  const settings = `${appUrl}/settings#reminders-heading`;
  let subject: string;
  let lead: string;
  let link: string;
  let action: string;

  if (kind === "test") {
    subject = "DayKind test notification";
    lead = "This is the test you asked for. Check-in reminders will arrive like this.";
    link = `${appUrl}/`;
    action = "Open DayKind";
  } else {
    const name = kind === "morning" ? "morning check-in" : "evening check-in";
    const day = formatLocalDate(localDate);
    subject = stage === "initial" ? `Your DayKind ${name} is ready` : `Reminder: your DayKind ${name} is still open`;
    lead =
      stage === "initial"
        ? `Your ${name} for ${day} is ready when you have a minute.`
        : `Your ${name} for ${day} is still open. This is the only follow-up.`;
    link = `${appUrl}/check-in/${kind}?date=${localDate}`;
    action = `Open the ${name}`;
  }

  const footer = [
    "You get these because email reminders are on in DayKind. Change or turn them off in Settings:",
    settings,
    "Email can be delayed or missed; the Today screen always shows what's due.",
  ];
  const text = [lead, "", `${action}: ${link}`, "", ...footer].join("\n");
  const html = [
    `<p>${escapeHtml(lead)}</p>`,
    `<p><a href="${escapeHtml(link)}">${escapeHtml(action)}</a></p>`,
    `<p style="color:#666;font-size:13px">${escapeHtml(footer[0])} <a href="${escapeHtml(settings)}">Settings</a>.<br>${escapeHtml(footer[2])}</p>`,
  ].join("\n");
  return { subject, text, html, link };
}
