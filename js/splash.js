/* Home startup checks saved data, the live dashboard, and app routes.
 * Route checks load documents without running their scripts or opening devices.
 */
(function () {
  const root = document.documentElement;
  const overlay = document.getElementById('arete-splash');
  const status = document.getElementById('arete-splash-status');
  const visible = root.classList.contains('splash-on');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const started = window.__splashT0 || Date.now();
  const controller = new AbortController();
  const routes = [
    'workouts.html', 'nutrition.html', 'recovery.html', 'steps.html',
    'exercises.html', 'programs.html', 'analytics.html', 'consistency.html',
    'connected-health.html', 'connections.html', 'settings.html', 'goals.html',
    'tasks.html', 'habits.html', 'finance.html', 'curl-lab.html', 'velocity-lab.html', 'isometric.html',
    'login.html',
  ];
  const pending = new Set();
  const assets = new Map();
  const report = { storage:true, recovered:[], missing:[], unavailableRoutes:[], unavailableAssets:[], timedOut:false };
  let finished = false;
  let dismissed = false;

  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    clearTimeout(window.__splashFallback);
    try { sessionStorage.setItem('arete_splash', '1'); } catch (_) {}
    overlay.classList.add('out');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.pointerEvents = 'none';
    setTimeout(() => {
      overlay.remove();
      root.classList.remove('splash-on');
    }, reduceMotion ? 0 : 420);
  }

  if (visible) {
    overlay.addEventListener('pointerdown', dismiss);
    window.addEventListener('pageshow', event => { if (event.persisted) dismiss(); });
  } else {
    overlay.remove();
  }

  function checkSavedData() {
    const probe = '__arete_probe';
    try {
      localStorage.setItem(probe, '1');
      report.storage = localStorage.getItem(probe) === '1';
      localStorage.removeItem(probe);
      const keys = Object.keys(localStorage).filter(key => /^(jarvis_|arete_)/.test(key) && !key.startsWith('arete_recovered_'));
      for (const key of keys) {
        const value = localStorage.getItem(key);
        if (!value || !/^[\[{]/.test(value.trim())) continue;
        try { JSON.parse(value); } catch (_) {
          const backup = 'arete_recovered_' + key;
          const destination = localStorage.getItem(backup) === null ? backup : backup + '_' + Date.now();
          try {
            localStorage.setItem(destination, value);
            if (localStorage.getItem(destination) !== value) continue;
            localStorage.removeItem(key);
            report.recovered.push(key);
          } catch (_) {
            report.missing.push('Saved data recovery');
          }
        }
      }
    } catch (_) { report.storage = false; }
  }

  async function check(name, test, failures) {
    pending.add(name);
    try {
      if (!await test() && !finished) failures.push(name);
    } catch (_) {
      if (!finished) failures.push(name);
    } finally {
      pending.delete(name);
    }
  }

  async function readLocalFile(url) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(url, { signal:controller.signal });
        if (response.ok) {
          // The offline worker can return Home as a navigation fallback.
          if (new URL(response.url).pathname !== url.pathname) return null;
          return { type:response.headers.get('Content-Type') || '', text:await response.text() };
        }
        if (response.status < 500) return null;
      } catch (_) {
        if (controller.signal.aborted) return null;
      }
    }
    return null;
  }

  async function loadRoute(route) {
    const url = new URL(route, location.href);
    const file = await readLocalFile(url);
    if (!file?.text || !file.type.includes('text/html')) return false;
    // Warm the page's directly linked first-party scripts and styles once per startup.
    const links = file.text.matchAll(/\b(?:src|href)=["'](?:\.\/)?((?:js|css|features)\/[\w/.-]+\.(?:js|css))["']/g);
    for (const [, path] of links) {
      if (assets.has(path)) continue;
      assets.set(path, check(path, async () => {
        const asset = await readLocalFile(new URL(path, url));
        return !!asset?.text && !asset.type.includes('text/html');
      }, report.unavailableAssets));
    }
    return true;
  }

  function announceProblems() {
    const unavailable = report.unavailableRoutes.length || report.unavailableAssets.length;
    if (!report.recovered.length && report.storage && !report.missing.length && !unavailable && !report.timedOut) return;
    const main = document.querySelector('main');
    if (!main) return;
    const notice = document.createElement('div');
    notice.className = 'startup-notice';
    notice.setAttribute('role', 'status');
    const message = !report.storage
      ? 'Device storage is unavailable. Changes may not save.'
      : report.missing.length || report.timedOut
        ? 'Some features didn’t finish loading.'
        : unavailable
          ? 'Some screens couldn’t be checked. They’ll try to load when opened.'
          : 'Some unreadable saved data was backed up.';
    notice.textContent = message;
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Retry startup';
    retry.onclick = () => {
      try { sessionStorage.removeItem('arete_splash'); } catch (_) {}
      location.reload();
    };
    notice.append(retry);
    main.prepend(notice);
  }

  function finish(timedOut) {
    if (finished) return;
    finished = true;
    clearTimeout(deadline);
    report.timedOut = timedOut;
    report.pending = [...pending];
    controller.abort();
    window.__areteStartup = report;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', announceProblems, { once:true });
    else announceProblems();
    const minimum = reduceMotion ? 0 : Math.max(0, 1150 - (Date.now() - started));
    if (visible && !dismissed) setTimeout(dismiss, minimum);
  }

  checkSavedData();
  const deadline = setTimeout(() => finish(true), Math.max(0, 6000 - (Date.now() - started)));
  // A visit back to Home still checks its runtime without re-fetching every screen.
  const requestedRetry = visible || !sessionStorageHasSplash();
  const routeChecks = requestedRetry
    ? Promise.all(routes.map(route => check(route, () => loadRoute(route), report.unavailableRoutes)))
    : Promise.resolve();

  function sessionStorageHasSplash() {
    try { return sessionStorage.getItem('arete_splash') === '1'; } catch (_) { return false; }
  }

  function ready() {
    if (finished) return;
    if (status) status.textContent = 'Starting app features…';
    const checks = [
      ['Account session', () => window.__areteAuthReady],
      ['Nutrition summary', () => typeof window.syncNutritionWidget === 'function' && !!document.querySelector('#kc-goal')],
      ['Training plans', () => !!window.Training],
      ['Steps dashboard', () => window.__areteStepsReady],
      ['Connected Health', () => window.__areteHealthReady],
      ['Fitness and recovery', () => !!window.Fitness],
      ['Wearable connections', () => !!window.Wearables],
      ['Habits', () => !!window.Habits],
      ['Interaction controls', () => !!window.Feel && !!document.querySelector('.mnav')],
      ['App theme', () => !!document.querySelector('link[href="css/theme.css"]')?.sheet],
    ];
    Promise.all(checks.map(([name, test]) => check(name, test, report.missing))).then(() => {
      if (finished) return;
      if (status) status.textContent = 'Checking app screens…';
      return routeChecks.then(() => Promise.all(assets.values())).then(() => finish(false));
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once:true });
  else ready();
})();
