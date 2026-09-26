const CACHE_NAME = 'router-ia-shell-v2';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll([
      new URL('./', self.location).toString(),
      new URL('./index.html', self.location).toString(),
      new URL('./manifest.webmanifest', self.location).toString(),
      new URL('./logo.svg', self.location).toString(),
      new URL('./icon-192.svg', self.location).toString(),
      new URL('./icon-512.svg', self.location).toString(),
    ])),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) {
    return;
  }

  const isShellAsset = request.destination === 'document'
    || ['style', 'script', 'image', 'font', 'manifest'].includes(request.destination);

  if (!isShellAsset) return;

  event.respondWith(
    fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    }).catch(() => caches.match(request).then((cached) => cached || caches.match(new URL('./index.html', self.location))),
  );
});