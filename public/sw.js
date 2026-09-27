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
