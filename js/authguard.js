/* ============================================================================
 *  Auth guard — included on every app page (not on login.html).
 *  When accounts are configured (Auth.isConfigured()), this requires a signed-in
 *  session: no session → redirect to login.html. It hides the page until the
 *  check resolves so there's no flash of app content before the redirect, then
 *  pulls the user's cloud data and starts mirroring changes back up.
 *  When NOT configured, it does nothing — the app runs locally as before.
 * ==========================================================================*/
(function () {
  if (!window.Auth || !window.Auth.isConfigured()) return;

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
