// Cache revision is independent of the existing ?v=5 asset URLs in index.html.
// Only static files are cached. localStorage and health data are never touched.
const C = 'sleep-rhythm-7';
const F = ['./', './index.html', './morning.css?v=5', './sleep-insights.js?v=5', './morning-view.js?v=5', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(C).then(cache => cache.addAll(F.map(url => new Request(new URL(url, self.registration.scope), {cache:'reload'})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('sleep-rhythm-') && key !== C).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url), scope = new URL(self.registration.scope);
  if (request.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const network = fetch(request);
  event.waitUntil(network.then(response => response.ok && response.type !== 'opaque' ? caches.open(C).then(cache => cache.put(request, response.clone())) : undefined).catch(() => {}));
  event.respondWith(network.then(async response => {
    if (response.ok) return response;
    return await caches.match(request, {ignoreSearch:true}) || response;
  }).catch(async () => {
    const cached = await caches.match(request, {ignoreSearch:true});
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const page = await caches.match(new URL('./index.html', self.registration.scope).href);
      if (page) return page;
    }
    return Response.error();
  }));
});
