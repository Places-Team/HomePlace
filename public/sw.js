/*
 * Service worker — deliberately almost empty.
 *
 * Its job is to make the panel installable on a phone, not to cache it. A
 * dashboard exists to show the *current* state of a server, and a service
 * worker serving yesterday's page from cache would be showing a confident lie:
 * green dots for services that went down an hour ago.
 *
 * So: static assets are cached (they are content-hashed and safe), and
 * everything else goes to the network every time. When the network is gone,
 * the browser's own offline page is the honest answer.
 */

const STATIC_CACHE = "homeplace-static-v1";

self.addEventListener("install", (event) => {
  // Take over immediately instead of waiting for every tab to close — this is
  // one person's panel, not a site with a hundred open sessions.
  self.skipWaiting();
  event.waitUntil(caches.open(STATIC_CACHE));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/*
 * Push notifications.
 *
 * The payload is written by the server (see lib/push.ts). Clicking focuses an
 * already-open panel rather than opening a second copy of it — on a phone,
 * ending up with four HomePlace windows is its own small annoyance.
 */
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "HomePlace", body: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || "HomePlace", {
      body: payload.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      // A tag replaces an earlier notification with the same one: a service
      // flapping should not stack up ten identical lines.
      tag: payload.tag || "homeplace",
      requireInteraction: payload.urgent === true,
      data: { url: payload.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Build output and icons only: their URLs change when their contents change.
  const cacheable = url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icon-");
  if (!cacheable) return;

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          const copy = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
    )
  );
});
