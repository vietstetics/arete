/* ============================================================================
 *  Mobile bottom navigation — shared across every page.
 *  The desktop sidebar is hidden on phones, leaving no way to move between
 *  pages. This injects a luxurious frosted tab bar (+ a "More" sheet) that
 *  only shows at ≤767px, highlights the current page, and works on the light
 *  and dark themed pages alike. Self-contained: it injects its own CSS.
 * ==========================================================================*/
(function () {
  if (window.__mnav) return; window.__mnav = true;

  // Block the browser's left-edge swipe-back so the app doesn't navigate away
  // like a website. Only fires for a drag that starts at the very screen edge,
  // so normal scrolling and taps are untouched.
  document.addEventListener('touchstart', function (e) {
    if (e.touches.length === 1 && e.touches[0].clientX <= 16) {
      try { e.preventDefault(); } catch (_) {}
    }
  }, { passive: false });

  var ic = {
    home:    '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    train:   '<path d="M13 10V3L4 14h7v7l9-11h-7z"/>',
    food:    '<path d="M3 11l19-9-9 19-2-8-8-2z"/>',
    recover: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
    more:    '<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
    connect: '<path d="M9 12a3 3 0 0 1 3-3h2.5a3.5 3.5 0 0 0 0-7H11M15 12a3 3 0 0 1-3 3H9.5a3.5 3.5 0 0 0 0 7H13"/>',
    sleep:   '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
    programs:'<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    exercises:'<path d="M4 6h16M4 10h16M4 14h10"/>',
    progress:'<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
    tasks:   '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    finance: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  };
  var svg = function (paths) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + paths + '</svg>'; };

  var TABS = [
    { href: 'index.html',    label: 'Home',     icon: ic.home },
    { href: 'workouts.html', label: 'Train',    icon: ic.train },
    { href: 'nutrition.html',label: 'Food',     icon: ic.food },
    { href: 'recovery.html', label: 'Recovery', icon: ic.recover },
  ];
  var MORE = [
    { href: 'connections.html', label: 'Connections', icon: ic.connect },
    { href: 'habits.html', label: 'Habits', icon: ic.tasks },
    { href: 'sleep.html',       label: 'Sleep',       icon: ic.sleep },
    { href: 'exercises.html',   label: 'Exercises',   icon: ic.exercises },
    { href: 'analytics.html',   label: 'Progress',    icon: ic.progress },
    { href: 'finance.html',     label: 'Finance',     icon: ic.finance },
    { href: 'settings.html',    label: 'Settings',    icon: ic.settings },
  ];

  var cur = (location.pathname.split('/').pop() || 'index.html');
  if (!cur) cur = 'index.html';
  var inMore = MORE.some(function (m) { return m.href === cur; });

  var css = ''
    + '.mnav,.mnav-sheet-bk{display:none}'
    + '@media(max-width:767px){'
    + '.mnav{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:120;justify-content:space-around;align-items:stretch;'
    +   'background:rgba(255,255,255,.78);-webkit-backdrop-filter:saturate(180%) blur(22px);backdrop-filter:saturate(180%) blur(22px);'
    +   'border-top:1px solid rgba(0,0,0,.07);box-shadow:0 -6px 24px rgba(16,40,28,.06);'
    +   'padding:7px 6px calc(7px + env(safe-area-inset-bottom,0px))}'
    + '.mnav button{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:4px 2px;border:none;background:none;'
    +   'color:#9aa0a6;font:600 10px/1 -apple-system,BlinkMacSystemFont,Inter,sans-serif;cursor:pointer;transition:color .15s}'
    + '.mnav button svg{width:23px;height:23px}'
    + '.mnav button.on{color:#5E5CE6}'
    + '.mnav button:active{transform:scale(.92)}'
    + '.main{padding-bottom:78px!important}'
    + '.mnav-sheet-bk{display:block;position:fixed;inset:0;background:rgba(0,0,0,.36);z-index:130;opacity:0;pointer-events:none;transition:opacity .25s}'
    + '.mnav-sheet-bk.open{opacity:1;pointer-events:auto}'
    + '.mnav-sheet{position:fixed;left:0;right:0;bottom:0;z-index:131;background:#fff;border-radius:22px 22px 0 0;'
    +   'padding:8px 10px calc(16px + env(safe-area-inset-bottom,0px));box-shadow:0 -10px 40px rgba(0,0,0,.2);'
    +   'transform:translateY(101%);transition:transform .3s cubic-bezier(.22,1,.36,1);max-height:74vh;overflow-y:auto}'
    + '.mnav-sheet.open{transform:translateY(0)}'
    + '.mnav-grab{width:40px;height:4px;border-radius:2px;background:rgba(0,0,0,.16);margin:8px auto 6px}'
    + '.mnav-sheet a{display:flex;align-items:center;gap:13px;padding:13px 14px;border-radius:13px;color:#1D1D1F;'
    +   'font:600 15px/1 -apple-system,BlinkMacSystemFont,Inter,sans-serif;text-decoration:none}'
    + '.mnav-sheet a:active{background:rgba(0,0,0,.05)}'
    + '.mnav-sheet a svg{width:20px;height:20px;color:#8a8a94}'
    + '.mnav-sheet a.on{color:#5E5CE6}.mnav-sheet a.on svg{color:#5E5CE6}'
    + '}';
  var style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  function build() {
    var bar = document.createElement('nav'); bar.className = 'mnav';
    TABS.forEach(function (t) {
      var b = document.createElement('button');
      b.className = (t.href === cur ? 'on' : '');
      b.innerHTML = svg(t.icon) + '<span>' + t.label + '</span>';
      b.onclick = function () { if (t.href !== cur) location.href = t.href; };
      bar.appendChild(b);
    });
    document.body.appendChild(bar);
  }

  if (document.body) build();
  else document.addEventListener('DOMContentLoaded', build);
})();
