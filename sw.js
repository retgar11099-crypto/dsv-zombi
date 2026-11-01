const CACHE = 'dsv-zombi-v3'
const OFFLINE_URL = './offline.html'
const PRECACHE = ['./', './index.html', './offline.html', './manifest.webmanifest', './favicon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  let url
  try { url = new URL(request.url) } catch { return }
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {})
          return response
        })
        .catch(() => caches.match(OFFLINE_URL).then((cached) => cached || Response.error())),
    )
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone()
            caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {})
          }
          return response
        })
        .catch(() => cached)
      return cached || network
    }),
  )
})
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
      // quiet prefetch: warm hashed assets from the latest index.html
      try {
        const cache = await caches.open(CACHE);
        const html = await (await fetch('./index.html')).text();
        const urls = [...html.matchAll(/(?:src|href)\s*=\s*["']\.?\/?(assets\/[^"']+)["']/g)].map((m) => './' + m[1]);
        await Promise.all(urls.map((u) => fetch(u).then((resp) => { if (resp.status === 200) return cache.put(u, resp); }).catch(() => {})));
      } catch (e) { /* offline */ }
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
      // quiet prefetch: warm hashed assets from the latest index.html
      try {
        const cache = await caches.open(CACHE);
        const html = await (await fetch('./index.html')).text();
        const urls = [...html.matchAll(/(?:src|href)\s*=\s*["']\.?\/?(assets\/[^"']+)["']/g)].map((m) => './' + m[1]);
        await Promise.all(urls.map((u) => fetch(u).then((resp) => { if (resp.status === 200) return cache.put(u, resp); }).catch(() => {})));
      } catch (e) { /* offline */ }
    })(),
  )
})