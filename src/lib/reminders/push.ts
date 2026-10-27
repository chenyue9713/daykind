// Browser push through the Web Push protocol with VAPID (the `web-push`
// library handles signing and payload encryption, so push services only see
// ciphertext). The occurrence id is used as the Topic, so a retried or
// re-claimed push replaces an undelivered earlier one instead of adding a
// second alert.
import webpush from "web-push";

import type { SendResult } from "./email";

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Where a click opens. A page that requires sign-in; no tokens. */
  url: string;
  /** Replaces an earlier notification with the same tag on the device. */
  tag: string;
}

/** `gone` (HTTP 404/410): the browser unsubscribed or the subscription expired. */
export type PushResult = SendResult | { outcome: "gone"; code: string };

export interface PushSender {
  send(target: PushTarget, payload: PushPayload, idempotencyKey: string): Promise<PushResult>;
}

type SendNotification = typeof webpush.sendNotification;

/** Daily reminders are useless after their two-hour window, so push services may drop them then. */
const TTL_SECONDS = 2 * 60 * 60;

export function createWebPushSender({
  publicKey,
  privateKey,
  subject,
  sendNotification = webpush.sendNotification.bind(webpush),
}: {
  publicKey: string;
  privateKey: string;
  subject: string;
  sendNotification?: SendNotification;
}): PushSender {
  return {
    async send(target, payload, idempotencyKey) {
      try {
        const result = await sendNotification(
          { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
          JSON.stringify(payload),
          {
            vapidDetails: { subject, publicKey, privateKey },
            TTL: TTL_SECONDS,
            urgency: "normal",
            // Topic: at most 32 URL-safe characters.
            topic: idempotencyKey.replaceAll("-", "").slice(0, 32),
            timeout: 10_000,
          },
        );
        return { outcome: "sent", messageId: `push_${result.statusCode}` };
      } catch (error) {
        const status = (error as { statusCode?: unknown }).statusCode;
        if (typeof status !== "number") return { outcome: "transient", code: "network" };
        const code = `http_${status}`;
        if (status === 404 || status === 410) return { outcome: "gone", code };
        if (status === 429 || status >= 500) return { outcome: "transient", code };
        return { outcome: "permanent", code };
      }
    },
  };
}
