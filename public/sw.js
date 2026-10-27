// DayKind service worker. Its only job is to show reminder notifications
// pushed by the server and open DayKind when one is clicked. Payloads hold
// generic text and a link to a page that requires sign-in; no health details.
// It does not cache pages or work offline.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

/** A path on this site only, whatever the payload says. */
function sameOriginUrl(value) {
  try {
    const url = new URL(value, self.location.origin);
    return self.location.origin + url.pathname + url.search;
  } catch {
    return self.location.origin + "/";
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const text = (value, fallback) => (typeof value === "string" && value.length <= 200 ? value : fallback);
  event.waitUntil(
    self.registration.showNotification(text(data.title, "DayKind"), {
      body: text(data.body, "A check-in is open."),
      tag: text(data.tag, "daykind"),
      icon: "/favicon.ico",
      data: { url: sameOriginUrl(data.url) },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? self.location.origin + "/";
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (client.url === url && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    })(),
  );
});
