/* ============================================================================
 *  Arete service worker — makes the app installable and usable offline.
 *  - HTML: network-first (always fresh when online, cached copy offline)
 *  - Assets (css/js): stale-while-revalidate
 *  - Never touches /api/ or cross-origin requests (Open Food Facts, fonts…)
 *  Bump VERSION to invalidate old caches on deploy.
 * ==========================================================================*/
const VERSION = 'arete-v1';

const CORE = [
  'index.html', 'workouts.html', 'nutrition.html', 'recovery.html',
  'sleep.html', 'steps.html', 'habits.html', 'exercises.html',
  'connections.html', 'connected-health.html', 'analytics.html',
  'finance.html', 'goals.html', 'settings.html', 'login.html',
  'css/theme.css', 'css/touch.css',
  'js/auth.js', 'js/authguard.js', 'js/fitness.js', 'js/habits.js',
  'js/mobilenav.js', 'js/wearables.js', 'js/energy.js',
  'manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then((cache) =>
      // add files one-by-one so a single 404 can't block install
      Promise.allSettled(CORE.map((u) => cache.add(u)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;      // OFF, fonts, etc.
  if (url.pathname.startsWith('/api/')) return;         // never cache API calls

  const isHTML = req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/';
  if (isHTML) {
    // network-first: fresh pages online, cached pages offline
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || caches.match('index.html')))
    );
    return;
  }

  // assets: stale-while-revalidate
  e.respondWith(
    caches.match(req).then((hit) => {
      const refresh = fetch(req).then((res) => {
        if (res && res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
        return res;
      }).catch(() => hit);
      return hit || refresh;
    })
  );
});
