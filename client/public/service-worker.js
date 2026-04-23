const CACHE_NAME = "getotps-static-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll([OFFLINE_URL])),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  const isApi = url.pathname.startsWith("/api");
  const isHtml = request.mode === "navigate" || request.headers.get("accept")?.includes("text/html");
  const isStaticAsset = /\.(js|css|png|jpg|jpeg|svg|webp|woff2?)$/.test(url.pathname);

  if (isApi) {
    event.respondWith(fetch(request));
    return;
  }

  if (isHtml) {
    event.respondWith(
      fetch(request)
        .then((response) => response)
        .catch(() => caches.match(OFFLINE_URL)),
    );
    return;
  }

  if (isStaticAsset) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        });
      }),
    );
  }
});
