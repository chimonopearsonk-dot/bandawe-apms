/**
 * Bandawe Zone APMS — Service Worker
 *
 * Strategy:
 *   - Pre-cache every asset the app needs to boot (HTML, CSS, JS, vendor files).
 *   - On fetch: serve from cache first; fall back to network if not cached.
 *   - On activate: clean up old cache versions.
 *
 * Bump CACHE_VERSION whenever you deploy changes so clients pick them up.
 */

const CACHE_VERSION = 'bandawe-apms-v8';

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',

  // App styles
  './css/app.css',

  // App entry point + core
  './js/main.js',
  './js/core/config.js',
  './js/core/state.js',
  './js/core/events.js',

  // Services
  './js/services/storage.js',
  './js/services/auth.service.js',
  './js/services/learner.service.js',
  './js/services/marks.service.js',
  './js/services/import.service.js',
  './js/services/export.service.js',
  './js/services/analytics.service.js',
  './js/services/image-store.service.js',
  './js/services/report-card.service.js',
  './js/services/backup.service.js',

  // UI
  './js/ui/helpers.js',
  './js/ui/toast.js',
  './js/ui/enrollment.ui.js',
  './js/ui/marks.ui.js',
  './js/ui/analytics.ui.js',
  './js/ui/broadsheet.ui.js',
  './js/ui/reports.ui.js',
  './js/ui/settings.ui.js',
  './js/ui/admin.ui.js',
  './js/ui/controller.js',

  // Vendor
  './css/tailwind.generated.css',
  './vendor/fontawesome.min.css',
  './vendor/xlsx.full.min.js',
  './vendor/exceljs.min.js',
  './vendor/webfonts/fa-solid-900.woff2',
  './vendor/webfonts/fa-regular-400.woff2',
  './vendor/webfonts/fa-brands-400.woff2',
  './vendor/webfonts/fa-v4compatibility.woff2',
];

/* Install: pre-cache everything */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => {
      // addAll fails if ANY URL fails; use individual puts so one 404 doesn't kill install
      return Promise.all(
        PRECACHE_URLS.map(url =>
          cache.add(url).catch(err => {
            console.warn('[sw] failed to cache', url, err);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

/* Activate: clean old caches */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(key => {
        if (key !== CACHE_VERSION) return caches.delete(key);
      }))
    ).then(() => self.clients.claim())
  );
});

/* Fetch: cache-first with network fallback */
self.addEventListener('fetch', event => {
  const req = event.request;

  // Only handle GET
  if (req.method !== 'GET') return;

  // Skip cross-origin requests (CDNs, etc.) — let them hit the network normally
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;

      // Not in cache — fetch and store a copy
      return fetch(req).then(res => {
        if (!res || res.status !== 200 || res.type !== 'basic') return res;
        const copy = res.clone();
        caches.open(CACHE_VERSION).then(cache => cache.put(req, copy));
        return res;
      }).catch(() => {
        // If fetch fails and the request was for the HTML shell, serve cached index.html
        if (req.mode === 'navigate') return caches.match('./index.html');
      });
    })
  );
});