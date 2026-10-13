// HomeSync service worker — app shell caching for offline-first usage.
// Uses registration scope (not "/") so this works under a GH Pages subpath base.
const CACHE = "homesync-v1";
const SCOPE = self.registration.scope;
const SHELL = [SCOPE, `${SCOPE}manifest.webmanifest`, `${SCOPE}favicon.ico`];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((c) => c.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match(SCOPE))),
  );
});

const PUSH_ROUTES = {
  shopping_item_added: `${SCOPE}shopping`,
  shopping_finished: `${SCOPE}shopping`,
  habit_logged: SCOPE,
  recipe_added: `${SCOPE}cookbook`,
};

self.addEventListener("push", (event) => {
  let payload = { title: "HomeSync", body: "", data: {} };
  try {
    if (event.data) payload = event.data.json();
  } catch {
    // fall back to generic payload above
  }

  const { title = "HomeSync", body = "", data = {} } = payload;

  event.waitUntil(
    self.registration
      .showNotification(title, {
        body,
        icon: `${SCOPE}icon-192.png`,
        badge: `${SCOPE}badge-96.png`,
        data,
      })
      .then(() => {
        const channel = new BroadcastChannel("homesync-push");
        channel.postMessage(payload);
        channel.close();
      }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const eventType = event.notification.data?.event_type;
  const targetPath = PUSH_ROUTES[eventType] ?? SCOPE;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const targetPathname = new URL(targetPath).pathname;
      const existing = clients.find((c) => new URL(c.url).pathname === targetPathname);
      if (existing) return existing.focus();
      return self.clients.openWindow(targetPath);
    }),
  );
});
