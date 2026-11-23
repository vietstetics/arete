/* ============================================================================
 *  Launch screen: the Arete mark eases in and its green line draws itself while
 *  the app gets ready, then the whole thing lifts away. Only when the app is
 *  opened (not when moving between its screens), and it can never get stuck:
 *  it leaves when the page has loaded and the checks are done, after at least
 *  the animation's length, and always within MAX_MS whatever happens (an error,
 *  a slow network, a script that never loads). A tap skips it.
 *
 *  While it plays it makes sure the app can start cleanly:
 *    1. storage works (private browsing can block it: the app then runs without saving);
 *    2. no saved record is corrupt: anything that should be JSON and isn't would crash the
 *       page that reads it, so it is set aside (kept under arete_recovered_<key>) and the app
 *       starts without it;
 *    3. the app's own scripts loaded (logged if not; the page still shows).
 *  The markup is in index.html (#arete-splash), drawn in the first frame.
 * ==========================================================================*/
(function () {
  var el = document.getElementById('arete-splash');
  var MIN_MS = 1150, MAX_MS = 3000;
  var t0 = window.__splashT0 || Date.now();
  var root = document.documentElement;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  var done = false;
  function leave() {
    if (done) return; done = true;
    try { sessionStorage.setItem('arete_splash', '1'); } catch (_) {}
    if (!el) return;
    el.classList.add('out');
    setTimeout(function () { el.remove(); root.classList.remove('splash-on'); }, reduce ? 150 : 420);
  }
  // Shown only on opening the app (decided in index.html's <head>, before the first frame: the
  // html gets .splash-on). Otherwise the checks still run, with nothing on screen.
  if (el && !root.classList.contains('splash-on')) { el.remove(); el = null; }
  if (el) {
    // Never stuck: leave by MAX_MS no matter what.
    setTimeout(leave, MAX_MS);
    el.addEventListener('pointerdown', leave);
    window.addEventListener('pageshow', function (e) { if (e.persisted) leave(); });
  }

  // ── The checks ──────────────────────────────────────────────────────────
  var report = { storage: true, recovered: [], missing: [] };
  function checkStorage() {
    try { localStorage.setItem('__arete_probe', '1'); localStorage.removeItem('__arete_probe'); }
    catch (_) { report.storage = false; }
  }
  function repairSaved() {
    if (!report.storage) return;
    var keys = [];
    try { for (var i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i)); } catch (_) { return; }
    keys.forEach(function (k) {
      if (!k || !/^(jarvis_|arete_)/.test(k) || /^arete_recovered_/.test(k)) return;
      var v; try { v = localStorage.getItem(k); } catch (_) { return; }
      if (typeof v !== 'string') return;
      var s = v.trim();
      if (!(s[0] === '{' || s[0] === '[')) return; // plain values aren't JSON and are fine
      try { JSON.parse(s); } catch (_) {
        try { localStorage.setItem('arete_recovered_' + k, v); localStorage.removeItem(k); report.recovered.push(k); } catch (__) {}
      }
    });
  }
  function checkScripts() {
    [['Fitness', 'js/fitness.js'], ['Auth', 'js/auth.js'], ['Feel', 'js/feel.js']].forEach(function (p) { if (!window[p[0]]) report.missing.push(p[1]); });
  }
  // Storage and saved data are checked now, before the app's scripts read them.
  try { checkStorage(); repairSaved(); } catch (_) {}

  function ready() {
    try { checkScripts(); } catch (_) {}
    window.__areteStartup = report;
    if (report.recovered.length || report.missing.length || !report.storage) console.warn('Arete startup:', report);
    var wait = Math.max(0, MIN_MS - (Date.now() - t0));
    setTimeout(leave, reduce ? 0 : wait);
  }
  // Usable as soon as the page's scripts have run (DOMContentLoaded), not when every font and image is in.
  if (document.readyState !== 'loading') ready(); else document.addEventListener('DOMContentLoaded', ready);
})();
