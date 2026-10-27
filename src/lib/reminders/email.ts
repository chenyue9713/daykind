// Email delivery through Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email).
// The occurrence id is sent as the Idempotency-Key, so a retried or
// re-claimed send within 24 hours cannot produce a second email.

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
}

/**
 * - sent: accepted by the mail service (not "read" or "in the inbox").
 * - transient: worth retrying (rate limit, server error, network, timeout).
 * - permanent: retrying will not help (bad address, unverified sender, bad key).
 * `code` is a short identifier for logs and status, never message content.
 */
export type SendResult =
  | { outcome: "sent"; messageId: string }
  | { outcome: "transient"; code: string }
  | { outcome: "permanent"; code: string };

export interface EmailSender {
  send(email: OutgoingEmail): Promise<SendResult>;
}

const RESEND_URL = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

export function createResendSender({
  apiKey,
  from,
  fetchImpl = fetch,
}: {
  apiKey: string;
  from: string;
  fetchImpl?: typeof fetch;
}): EmailSender {
  return {
    async send(email) {
      let response: Response;
      try {
        response = await fetchImpl(RESEND_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": email.idempotencyKey,
          },
          body: JSON.stringify({ from, to: [email.to], subject: email.subject, text: email.text, html: email.html }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        const name = error instanceof Error ? error.name : "";
        return { outcome: "transient", code: name === "TimeoutError" ? "timeout" : "network" };
      }

      let body: { id?: unknown; name?: unknown } = {};
      try {
        body = (await response.json()) as typeof body;
      } catch {
        // Some error responses have no JSON body.
      }
      if (response.ok && typeof body.id === "string") return { outcome: "sent", messageId: body.id };
      const code = `http_${response.status}${typeof body.name === "string" ? `_${body.name}`.slice(0, 60) : ""}`;
      // 409 concurrent_idempotent_requests: an earlier request with this key is still in progress.
      const concurrent = response.status === 409 && String(body.name ?? "").includes("concurrent");
      if (response.status === 429 || concurrent || response.status >= 500 || response.ok) {
        return { outcome: "transient", code };
      }
      return { outcome: "permanent", code };
    },
  };
}
