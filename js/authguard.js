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

  if (!window.Auth.isConfigured()) {
    if (!window.Auth.localSession()) location.replace('login.html');
    return;
  }

  var hide = document.createElement('style');
  hide.id = '__authhide';
  hide.textContent = 'body{visibility:hidden !important}';
  (document.head || document.documentElement).appendChild(hide);
  function reveal() { var s = document.getElementById('__authhide'); if (s) s.remove(); }

  window.Auth.getSession().then(function (session) {
    if (!session) { location.replace('login.html'); return; }
    reveal();
    window.Auth.watch();
    window.Auth.pull().catch(function () {});
  }).catch(reveal);

  setTimeout(reveal, 4000); // never leave the page hidden if something stalls
})();
