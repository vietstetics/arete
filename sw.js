/* ============================================================================
 *  Arete service worker — makes the app installable and usable offline.
 *  - HTML: network-first (always fresh when online, cached copy offline)
 *  - Assets (css/js): stale-while-revalidate
 *  - Never touches /api/ or cross-origin requests (Open Food Facts, fonts…)
 *  Bump VERSION to invalidate old caches on deploy.
 * ==========================================================================*/
const VERSION = 'arete-v60';

const CORE = [
  'index.html', 'workouts.html', 'nutrition.html', 'recovery.html',
  'steps.html', 'habits.html', 'exercises.html',
  'connections.html', 'connected-health.html', 'analytics.html', 'consistency.html',
  'finance.html', 'goals.html', 'settings.html', 'login.html', 'programs.html', 'tasks.html',
  'css/theme.css', 'css/touch.css', 'css/training.css', 'css/motion.css', 'js/motion.js', 'brand-logo.png', 'brand-logo-light.png', 'brand-mark.png', 'icon-fat.png', 'favicon-32.png', 'brand-mark-base.png', 'brand-mark-line.png', 'js/splash.js',
  'js/auth.js', 'js/setSync.js', 'js/authguard.js', 'js/fitness.js', 'js/habits.js',
  'js/mobilenav.js', 'js/workoutcard.js', 'js/focuslock.js', 'js/feel.js', 'css/train.css', 'arete-logo.png', 'js/consistency.js', 'js/wearables.js', 'js/energy.js',
  'features/training/index.js', 'features/training/services/schedule.js',
  'features/training/services/consistency.js', 'features/training/services/analytics.js', 'features/training/repositories/planStore.js',
  'features/training/data/starters.js', 'features/training/ui/planWizard.js', 'features/training/ui/planHome.js',
  'features/steps/stepsApp.js', 'features/steps/util/date.js', 'features/steps/native/stepCounterPlugin.js',
  'features/steps/repositories/stepRepository.js', 'features/steps/services/stepTrackingService.js',
  'features/steps/services/stepSyncService.js', 'features/steps/services/stepStats.js',
  'features/steps/components/stepStyles.js', 'features/steps/components/stepProgress.js',
  'features/steps/components/stepHistoryChart.js', 'features/steps/components/stepPermissionCard.js',
  'features/health/native/healthPlugin.js', 'features/health/repositories/healthRepository.js',
  'features/health/providers/nativeAdapter.js', 'features/health/providers/appleHealthAdapter.js',
  'features/health/providers/healthConnectAdapter.js', 'features/health/providers/cloudAdapters.js',
  'features/health/services/healthDataService.js', 'features/health/services/healthDeduplication.js',
  'features/health/services/healthSourcePreferences.js', 'features/health/services/healthSyncService.js',
  'features/health/ui/connectedHealth.js', 'features/health/ui/healthPermissionDialog.js',
  'features/health/ui/healthSourceSettings.js', 'js/zxing.min.js',
  'features/muscles/index.js', 'features/muscles/data/muscleActions.js',
  'features/muscles/services/parse.js', 'features/muscles/repositories/exerciseLinks.js',
  'features/exercises/index.js', 'features/exercises/data/catalogue.js',
  'features/exercises/services/catalogue.js', 'features/exercises/services/overlap.js',
  'features/exercises/services/coverage.js', 'features/exercises/ui/overlapPanel.js',
  'css/machines.css',
  'features/machines/index.js', 'features/machines/data/machines.js', 'features/machines/data/exercises.js',
  'features/machines/services/source.js', 'features/machines/services/actions.js', 'features/machines/services/muscles.js',
  'features/machines/services/profile.js', 'features/machines/services/match.js', 'features/machines/services/db.js',
  'features/machines/ui/machineUI.js',
  'manifest.webmanifest',
  'icon-180.png', 'icon-192.png', 'icon-512.png',
  'curl-lab.html', 'velocity-lab.html',
  'features/standard/services/repEngine.js', 'features/standard/services/velocity.js',
  'features/standard/services/liftFeatures.js', 'features/standard/services/liftTrackers.js', 'features/standard/services/liftDemo.js',
  'features/velocity/index.js', 'features/velocity/services/record.js',
  'features/velocity/services/workout.js', 'features/velocity/services/sources.js',
  'features/velocity/services/pipeline.js', 'features/velocity/services/timing.js',
  'features/velocity/services/smooth.js', 'features/velocity/services/metrics.js',
  'features/velocity/services/weight.js', 'features/velocity/services/compare.js',
  'features/velocity/services/bar3d.js', 'features/velocity/demo/synth.js',
  'features/velocity/services/live/plateSession.js', 'features/velocity/services/live/frameGrabber.js',
  'features/velocity/services/live/motion.js', 'features/velocity/services/sbd.js', 'features/velocity/services/vision/marker.js',
  'features/velocity/services/live/frameClock.js', 'features/velocity/services/live/playVideo.js',
  'features/velocity/services/vision/image.js', 'features/velocity/services/vision/geometry.js',
  'features/velocity/services/vision/ellipse.js', 'features/velocity/services/vision/plate.js',
  'features/velocity/services/vision/camera.js', 'features/velocity/services/vision/circle3d.js',
  'features/velocity/services/vision/plate3d.js',
  'css/velocity-coach.css', 'features/velocity/services/coachMetrics.js',
  'features/velocity/services/predictions.js', 'features/velocity/services/readiness.js', 'features/velocity/services/setChain.js',
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
      fetch(req).then(async (res) => {
        if (res.ok && new URL(res.url).pathname === url.pathname) {
          try { await (await caches.open(VERSION)).put(req, res.clone()); } catch (_) {}
        }
        if (res.status >= 500) return await caches.match(req) || res;
        return res;
      }).catch(async () => {
        const hit = await caches.match(req, { ignoreSearch:true });
        if (hit) return hit;
        if (req.mode === 'navigate') return await caches.match('index.html') || Response.error();
        return Response.error();
      })
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
