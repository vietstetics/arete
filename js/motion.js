/* ============================================================================
 *  Motion between screens: which kind of move each page change is (css/motion.css
 *  draws it), and getting the next page ready while the finger is still down.
 *  Loaded in <head> on every page, before the first frame, so the arriving page
 *  can name its transition in time.
 * ==========================================================================*/
(function () {
  if (window.__motion) return; window.__motion = true;
  var root = document.documentElement;
  // The main tabs (bottom bar and the More sheet): moving between them is a tab change, not going deeper.
  var TABS = ['index.html', 'workouts.html', 'nutrition.html', 'recovery.html', 'habits.html', 'sleep.html', 'connections.html', 'exercises.html', 'settings.html'];
  function page(url) {
    try { var p = new URL(url, location.href).pathname.split('/').pop(); return p || 'index.html'; } catch (_) { return ''; }
  }
  var isTab = function (u) { return TABS.indexOf(page(u)) >= 0; };

  // What kind of move: back (history going back, or up from a deeper screen to a tab), tab, or push.
  function kind(from, to, traverseBack) {
    if (traverseBack) return 'back';
    var f = isTab(from), t = isTab(to);
    if (f && t) return 'tab';
    if (!f && t) return 'back';
    return 'push';
  }

  var supported = 'onpagereveal' in window && typeof CSS !== 'undefined' && CSS.supports && CSS.supports('view-transition-name: a');
  if (!supported) {
    // No view transitions: the page eases in instead (motion.css), sliding from the left when it's a back.
    root.classList.add('no-vt');
    try {
      var last = sessionStorage.getItem('mo-from');
      if (last && kind(last, location.href, false) === 'back') root.classList.add('mo-back');
    } catch (_) {}
    window.addEventListener('pagehide', function () { try { sessionStorage.setItem('mo-from', location.href); } catch (_) {} });
  } else {
    window.addEventListener('pagereveal', function (e) {
      if (!e.viewTransition) return;
      var nav = window.navigation && navigation.activation;
      var from = nav && nav.from ? nav.from.url : document.referrer;
      var back = !!(nav && nav.navigationType === 'traverse' && nav.from && nav.entry && nav.entry.index < nav.from.index);
      if (!from) { e.viewTransition.skipTransition(); return; }
      try { e.viewTransition.types.add(kind(from, location.href, back)); } catch (_) {} // older Safari: no types, the default crossfade
    });
    window.addEventListener('pageswap', function (e) {
      if (!e.viewTransition || !e.activation) return;
      var back = e.activation.navigationType === 'traverse' && e.activation.entry && e.activation.from && e.activation.entry.index < e.activation.from.index;
      try { e.viewTransition.types.add(kind(location.href, e.activation.entry ? e.activation.entry.url : '', back)); } catch (_) {}
    });
  }

  // Ready before the finger lifts: fetch the page a link points to as soon as it's touched.
  var fetched = {};
  function warm(e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
    var url;
    try { url = new URL(a.href, location.href); } catch (_) { return; }
    if (url.origin !== location.origin || !/\.html$/.test(url.pathname) || url.pathname === location.pathname || fetched[url.pathname]) return;
    fetched[url.pathname] = true;
    var l = document.createElement('link'); l.rel = 'prefetch'; l.href = url.pathname; document.head.appendChild(l);
  }
  document.addEventListener('pointerdown', warm, { passive: true, capture: true });
  document.addEventListener('mouseover', warm, { passive: true, capture: true });
})();
