/* ============================================================================
 *  Auth guard — included on every app page (not on login.html).
 *  An account is REQUIRED to use the app.
 *  - Without Supabase configured: device accounts. The session check is
 *    synchronous, so there's no flash — no session, straight to login.html.
 *  - With Supabase configured: requires a signed-in cloud session; hides the
 *    page until the async check resolves, then pulls the user's cloud data
 *    and mirrors changes back up.
 * ==========================================================================*/

// Dev tools (js/devtools.js): only when the app is served from the computer on the home Wi-Fi
// (npm run dev), never on the live site. The pairing key from the printed link is kept before any
// redirect to login, then taken out of the address bar.
(function () {
  var h = location.hostname;
  if (!/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/.test(h) && !/\.local$/.test(h)) return;
  try {
    var m = location.search.match(/[?&]devkey=([a-f0-9]{24})/);
    if (m) {
      localStorage.setItem('arete.devkey', m[1]);
      history.replaceState(null, '', location.pathname + location.search.replace(/([?&])devkey=[a-f0-9]{24}&?/, '$1').replace(/[?&]$/, '') + location.hash);
    }
  } catch (_) {}
  var s = document.createElement('script'); s.src = 'js/devtools.js'; s.defer = true;
  (document.head || document.documentElement).appendChild(s);
})();

(function () {
  if (!window.Auth) return;
  // Signed out: to the login page, which brings you back to this page afterwards (only app pages).
  function toLogin() {
    var here = location.pathname.split('/').pop() + location.search;
    location.replace(/^[a-z0-9-]+\.html/.test(here) && !/^index\.html$/.test(here) ? 'login.html?next=' + encodeURIComponent(here) : 'login.html');
  }

  if (!window.Auth.isConfigured()) {
    var session = window.Auth.localSession();
    window.__areteAuthReady = Promise.resolve(!!session);
    if (!session) toLogin();
    return;
  }

  var hide = document.createElement('style');
  hide.id = '__authhide';
  hide.textContent = 'body{visibility:hidden !important}';
  (document.head || document.documentElement).appendChild(hide);
  function reveal() { var s = document.getElementById('__authhide'); if (s) s.remove(); }

  window.__areteAuthReady = window.Auth.getSession().then(function (session) {
    if (!session) { toLogin(); return false; }
    // A different account used this phone last (its sign-out never reached the cloud): this page was
    // drawn from that person's data. Clear it before anything is shown, then draw again.
    var owner = null; try { owner = localStorage.getItem(window.Auth.OWNER_KEY); } catch (_) {}
    if (owner && session.user && owner !== session.user.id) { window.Auth.resetDevice(); location.reload(); return false; }
    reveal();
    window.Auth.watch();
    window.Auth.pull().then(function (ok) { if (ok && window.SetSync) window.SetSync.start(); }).catch(function () {});
    return true;
  }).catch(function () { reveal(); return false; });

  // Storage full (js/auth.js): a change didn't save. Never fail silently.
  window.addEventListener('arete:storage-full', function () {
    if (document.getElementById('__storagefull') || !document.body) return;
    var b = document.createElement('div');
    b.id = '__storagefull'; b.setAttribute('role', 'alert');
    b.style.cssText = 'position:fixed;left:16px;right:16px;top:calc(env(safe-area-inset-top,0px) + 12px);z-index:9999;background:#1C1C1E;color:#fff;border-radius:12px;padding:12px 16px;font:500 14px/1.4 Inter,system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.18)';
    b.textContent = 'Your last change wasn’t saved: this phone’s storage for Arete is full. Delete old videos or history in the app, then try again. Tap to close.';
    b.onclick = function () { b.remove(); };
    document.body.appendChild(b);
  });

  // Text fields without their own limit get a sensible one, so a pasted essay can't fill storage.
  document.addEventListener('focusin', function (e) {
    var el = e.target;
    if (!el || el.maxLength > 0 || el.readOnly) return;
    if (el.tagName === 'TEXTAREA') el.maxLength = 5000;
    else if (el.tagName === 'INPUT' && /^(text|search|)$/.test(el.getAttribute('type') || '')) el.maxLength = 500;
  });

  // Changes from another device: the page was drawn from older data, so draw it again: straight away
  // while the page has only just opened, otherwise the next time the app comes back to the front, and
  // never while something is being typed.
  var loadedAt = Date.now(), stale = false, lastSync = Date.now();
  function typing() { var a = document.activeElement; return !!a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName); }
  // Camera and lab pages hold work that isn't saved yet (a recording, an analysis): never reload those.
  var keep = /(curl-lab|velocity-lab|drop-test|onboarding)\.html$/.test(location.pathname);
  function redraw() { if (stale && !keep && !typing()) { stale = false; location.reload(); } }
  window.addEventListener('arete:remote-change', function () { stale = true; if (Date.now() - loadedAt < 8000) redraw(); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    redraw();
    if (Date.now() - lastSync > 30000 && window.Auth.isPulled()) { lastSync = Date.now(); loadedAt = Date.now(); window.Auth.pull().catch(function () {}); }
  });

  setTimeout(reveal, 4000); // never leave the page hidden if something stalls
})();
