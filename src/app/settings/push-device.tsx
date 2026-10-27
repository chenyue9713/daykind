"use client";

import { useEffect, useState, useTransition } from "react";

import { newUuid } from "@/lib/uuid";
import { registerPushDevice, unregisterPushDevice } from "./reminder-actions";

type Support = "checking" | "unsupported" | "insecure" | "supported";

/** The VAPID public key (base64url) as the bytes PushManager.subscribe expects. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replaceAll("-", "+").replaceAll("_", "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  return navigator.serviceWorker.ready;
}

/**
 * Registers this browser for DayKind notifications, or removes it. Works in
 * desktop Chrome, Edge, Firefox, and Safari, and Chrome or Firefox on
 * Android, without installing the app. Needs HTTPS (or localhost).
 */
export function PushDevice({
  vapidPublicKey,
  registered,
  disabled,
}: {
  /** null when push is not configured on the server. */
  vapidPublicKey: string | null;
  /** The registered browser, if any. */
  registered: { endpoint: string; deviceLabel: string | null } | null;
  disabled: boolean;
}) {
  const [support, setSupport] = useState<Support>("checking");
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [ownEndpoint, setOwnEndpoint] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let next: Support = "supported";
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) next = "unsupported";
      else if (!window.isSecureContext) next = "insecure";
      let endpoint: string | null = null;
      if (next === "supported") {
        const existing = await navigator.serviceWorker.getRegistration("/");
        endpoint = (await existing?.pushManager.getSubscription())?.endpoint ?? null;
      }
      if (cancelled) return;
      setSupport(next);
      if (next === "supported") setPermission(Notification.permission);
      setOwnEndpoint(endpoint);
    })().catch(() => !cancelled && setSupport("unsupported"));
    return () => {
      cancelled = true;
    };
  }, []);

  const thisBrowser = registered !== null && ownEndpoint === registered.endpoint;

  const enable = () =>
    startTransition(async () => {
      setMessage(null);
      try {
        const granted = await Notification.requestPermission();
        setPermission(granted);
        if (granted !== "granted") {
          setMessage({ ok: false, text: "Notifications are blocked for DayKind in this browser. Allow them in the site settings, then try again." });
          return;
        }
        const reg = await registration();
        const options = { userVisibleOnly: true, applicationServerKey: keyBytes(vapidPublicKey!) };
        let subscription = await reg.pushManager.getSubscription();
        try {
          subscription ??= await reg.pushManager.subscribe(options);
        } catch {
          // A subscription made with an older server key: replace it.
          await subscription?.unsubscribe();
          subscription = await reg.pushManager.subscribe(options);
        }
        const result = await registerPushDevice(subscription.toJSON(), newUuid());
        if (result.ok) setOwnEndpoint(subscription.endpoint);
        setMessage({ ok: result.ok, text: result.message });
      } catch {
        setMessage({ ok: false, text: "This browser could not turn on notifications. Try again, or use email instead." });
      }
    });

  const disable = () =>
    startTransition(async () => {
      setMessage(null);
      try {
        const subscription = await (await navigator.serviceWorker.getRegistration("/"))?.pushManager.getSubscription();
        const endpoint = subscription?.endpoint ?? registered?.endpoint ?? "";
        await subscription?.unsubscribe();
        const result = await unregisterPushDevice(endpoint);
        if (result.ok) setOwnEndpoint(null);
        setMessage({ ok: result.ok, text: result.message });
      } catch {
        setMessage({ ok: false, text: "This browser could not turn notifications off. Try again." });
      }
    });

  let status: string;
  if (!vapidPublicKey) status = "Browser notifications aren't set up on this server yet (doc/reminders.md).";
  else if (support === "checking") status = "Checking this browser…";
  else if (support === "unsupported") status = "This browser can't receive web notifications. Use email, or open DayKind in Chrome, Edge, Firefox, or Safari on a computer, or Chrome on Android.";
  else if (support === "insecure") status = "Notifications need a secure (https) address. They work on the deployed app, or on localhost.";
  else if (thisBrowser) status = "This browser receives DayKind notifications.";
  else if (registered) status = `${registered.deviceLabel ?? "Another browser"} receives DayKind notifications. You can switch to this one.`;
  else status = "No browser is registered yet.";

  const ready = !disabled && vapidPublicKey !== null && support === "supported";
  return (
    <div className="stack-sm">
      <p className="small">{status}</p>
      {ready && permission === "denied" ? (
        <p className="notice small">
          Notifications are blocked for DayKind in this browser. Allow them in the browser&apos;s site settings, then
          reload this page.
        </p>
      ) : null}
      {message ? (
        <p className={`notice small ${message.ok ? "notice-success" : "notice-error"}`} role={message.ok ? "status" : "alert"}>
          {message.text}
        </p>
      ) : null}
      {ready ? (
        <div className="row">
          {thisBrowser ? (
            <button type="button" className="button button-secondary" onClick={disable} disabled={busy}>
              Stop notifications on this browser
            </button>
          ) : (
            <button type="button" className="button button-secondary" onClick={enable} disabled={busy || permission === "denied"}>
              {registered ? "Use this browser instead" : "Turn on notifications for this browser"}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
