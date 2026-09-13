const CACHE = 'vinko-stories-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const url = e.request.url;
  // Cache-first for Supabase public storage (images + audio)
  if (url.includes('supabase.co') && url.includes('/story-reader/')) {
    e.respondWith(
      caches.open(CACHE).then(c =>
        c.match(e.request).then(hit => {
          if (hit) return hit;
          return fetch(e.request).then(r => {
            if (r.ok) c.put(e.request, r.clone());
            return r;
          }).catch(() => new Response('', { status: 503 }));
        })
      )
    );
  }
});
