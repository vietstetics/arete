/* ============================================================================
 *  Mobile bottom navigation — shared across every page.
 *  Soft-green theme: a floating white pill (inset from the screen edges)
 *  with four tabs and a black centre action button ringed in lime that
 *  jumps straight to today's workout. A "More" sheet holds the rest.
 *  Only shows at ≤767px. Self-contained: it injects its own CSS.
 * ==========================================================================*/
(function () {
  if (window.__mnav) return; window.__mnav = true;

  // Offline support: register the service worker (https only — no-op in
  // file:// previews and the Capacitor webview handles its own caching).
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  // Block the browser's left-edge swipe-back so the app doesn't navigate away
  // like a website. Only fires for a drag that starts at the very screen edge,
  // so normal scrolling and taps are untouched.
  document.addEventListener('touchstart', function (e) {
    if (e.touches.length === 1 && e.touches[0].clientX <= 16) {
      try { e.preventDefault(); } catch (_) {}
    }
  }, { passive: false });

  var ic = {
    home:    '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
    train:   '<path d="M6 7v10M18 7v10M2 10v4M22 10v4M6 12h12"/>',
    food:    '<path d="M3 11l19-9-9 19-2-8-8-2z"/>',
    recover: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
    more:    '<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
    plus:    '<path d="M12 5v14M5 12h14"/>',
    connect: '<path d="M9 12a3 3 0 0 1 3-3h2.5a3.5 3.5 0 0 0 0-7H11M15 12a3 3 0 0 1-3 3H9.5a3.5 3.5 0 0 0 0 7H13"/>',
    sleep:   '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
    exercises:'<path d="M4 6h16M4 10h16M4 14h10"/>',
    progress:'<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
    habits:  '<path d="M13 2L4 14h6l-1 8 9-12h-6z"/>',
    finance: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  };
  var svg = function (paths) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + paths + '</svg>'; };

  var LEFT = [
    { href: 'index.html',    label: 'Home',  icon: ic.home },
    { href: 'workouts.html', label: 'Train', icon: ic.train },
  ];
  var RIGHT = [
    { href: 'nutrition.html', label: 'Food', icon: ic.food },
    { href: '#more',          label: 'More', icon: ic.more },
  ];
  var MORE = [
    { href: 'recovery.html',    label: 'Recovery',    icon: ic.recover },
    { href: 'habits.html',      label: 'Habits',      icon: ic.habits },
    { href: 'sleep.html',       label: 'Sleep',       icon: ic.sleep },
    { href: 'connections.html', label: 'Connections', icon: ic.connect },
    { href: 'exercises.html',   label: 'Exercises',   icon: ic.exercises },
    { href: 'analytics.html',   label: 'Progress',    icon: ic.progress },
    { href: 'finance.html',     label: 'Finance',     icon: ic.finance },
    { href: 'settings.html',    label: 'Settings',    icon: ic.settings },
  ];

  var cur = (location.pathname.split('/').pop() || 'index.html');
  if (!cur) cur = 'index.html';
  var inMore = MORE.some(function (m) { return m.href === cur; });

  var css = ''
    + '.mnav,.mnav-sheet-bk,.mnav-sheet{display:none}'
    + '@media(max-width:767px){'
    + '.mnav{display:flex;position:fixed;left:12px;right:12px;bottom:calc(10px + env(safe-area-inset-bottom,0px));z-index:120;'
    +   'justify-content:space-between;align-items:center;background:#fff;border-radius:26px;'
    +   'padding:8px 16px;box-shadow:0 8px 26px rgba(23,32,14,.18)}'
    + '.mnav button{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;padding:3px 2px;border:none;background:none;'
    +   'color:#8B957F;font:650 9.5px/1 -apple-system,BlinkMacSystemFont,Inter,sans-serif;cursor:pointer;transition:color .15s}'
    + '.mnav button svg{width:21px;height:21px}'
    + '.mnav button.on{color:#171B12}'
    + '.mnav button:active{transform:scale(.92)}'
    + '.mnav .mnav-fab{flex:0 0 auto;width:48px;height:48px;margin:-24px 8px 0;border-radius:50%;background:#171B12;'
    +   'display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 4px #58DB3D,0 8px 20px rgba(23,32,14,.3);padding:0}'
    + '.mnav .mnav-fab svg{width:21px;height:21px;color:#6BE44F;stroke-width:2.4}'
    + '.main{padding-bottom:96px!important}'
    + '.mnav-sheet-bk{display:block;position:fixed;inset:0;background:rgba(18,26,12,.4);z-index:130;opacity:0;pointer-events:none;transition:opacity .25s}'
    + '.mnav-sheet-bk.open{opacity:1;pointer-events:auto}'
    + '.mnav-sheet{display:block;position:fixed;left:0;right:0;bottom:0;z-index:131;background:#fff;border-radius:26px 26px 0 0;'
    +   'padding:8px 10px calc(16px + env(safe-area-inset-bottom,0px));box-shadow:0 -10px 40px rgba(18,26,12,.24);'
    +   'transform:translateY(101%);transition:transform .3s cubic-bezier(.22,1,.36,1);max-height:74vh;overflow-y:auto}'
    + '.mnav-sheet.open{transform:translateY(0)}'
    + '.mnav-grab{width:40px;height:4px;border-radius:2px;background:rgba(23,27,18,.16);margin:8px auto 6px}'
    + '.mnav-sheet a{display:flex;align-items:center;gap:13px;padding:13px 14px;border-radius:15px;color:#171B12;'
    +   'font:600 15px/1 -apple-system,BlinkMacSystemFont,Inter,sans-serif;text-decoration:none}'
    + '.mnav-sheet a:active{background:#DCF5D2}'
    + '.mnav-sheet a svg{width:20px;height:20px;color:#8B957F}'
    + '.mnav-sheet a.on{color:#237A12;background:#DCF5D2}.mnav-sheet a.on svg{color:#237A12}'
    + '}';
  var style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  function build() {
    var bk = document.createElement('div'); bk.className = 'mnav-sheet-bk';
    var sheet = document.createElement('div'); sheet.className = 'mnav-sheet';
    sheet.innerHTML = '<div class="mnav-grab"></div>' + MORE.map(function (m) {
      return '<a href="' + m.href + '"' + (m.href === cur ? ' class="on"' : '') + '>' + svg(m.icon) + m.label + '</a>';
    }).join('');
    var toggle = function (open) {
      bk.classList.toggle('open', open);
      sheet.classList.toggle('open', open);
    };
    bk.onclick = function () { toggle(false); };

    var bar = document.createElement('nav'); bar.className = 'mnav';
    var add = function (t) {
      var b = document.createElement('button');
      b.className = (t.href === cur || (t.href === '#more' && inMore) ? 'on' : '');
      b.innerHTML = svg(t.icon) + '<span>' + t.label + '</span>';
      b.onclick = function () {
        if (t.href === '#more') toggle(!sheet.classList.contains('open'));
        else if (t.href !== cur) location.href = t.href;
      };
      bar.appendChild(b);
    };
    LEFT.forEach(add);
    var fab = document.createElement('button'); fab.className = 'mnav-fab';
    fab.setAttribute('aria-label', "Start today's workout");
    fab.innerHTML = svg(ic.plus);
    fab.onclick = function () { location.href = 'workouts.html?start=today'; };
    bar.appendChild(fab);
    RIGHT.forEach(add);

    document.body.appendChild(bk);
    document.body.appendChild(sheet);
    document.body.appendChild(bar);
  }

  if (document.body) build();
  else document.addEventListener('DOMContentLoaded', build);
})();
