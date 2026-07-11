/* ============================================================================
 *  Auth guard — included on every app page (not on login.html).
 *  An account is REQUIRED to use the app.
 *  - Without Supabase configured: device accounts. The session check is
 *    synchronous, so there's no flash — no session, straight to login.html.
 *  - With Supabase configured: requires a signed-in cloud session; hides the
 *    page until the async check resolves, then pulls the user's cloud data
 *    and mirrors changes back up.
 * ==========================================================================*/
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
