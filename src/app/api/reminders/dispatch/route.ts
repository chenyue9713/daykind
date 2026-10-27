// Scheduler endpoint. Supabase pg_cron calls it every five minutes (see
// doc/reminders.md); any scheduler that can send an HTTP request with
// `Authorization: Bearer $REMINDER_DISPATCH_SECRET` works. POST is the
// documented method; GET is accepted for schedulers that only send GET.
// The response holds counts only.
import { dispatchReminders, isAuthorizedDispatch, reminderEnv } from "@/lib/reminders/server";

async function handle(request: Request): Promise<Response> {
  const status = reminderEnv();
  if (!status.configured) {
    // Without a configured secret nobody can be authorized; say so without listing what is missing.
    return Response.json({ error: "reminder delivery is not configured" }, { status: 503 });
  }
  if (!isAuthorizedDispatch(request.headers.get("authorization"), status.env.dispatchSecret)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const summary = await dispatchReminders(status.env);
    return Response.json(summary, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(`[daykind] reminders: run failed (${error instanceof Error ? error.message : "unknown"})`);
    return Response.json({ error: "dispatch failed" }, { status: 500 });
  }
}

export const POST = handle;
export const GET = handle;
