// Lock-in mode: while a workout runs, the apps the user picked (Instagram, TikTok, YouTube, Snapchat, …)
// are blocked by Apple's Screen Time (native/ios/FocusLockPlugin.swift). iPhone app only: on the web
// and Android there is no plugin and every call quietly does nothing.
//
// One rule decides it (shouldLock): a workout is open, not saved for later, and not unlocked early.
// workouts.html calls FocusLock.sync(active) whenever the workout changes; native calls only happen
// when the answer changes, one at a time, in order.
(function () {
  const DECLINED = 'arete_focuslock_declined';
  const HOLD_MS = 5000;

  /** Should the apps be blocked for this workout draft? */
  function shouldLock(active) {
    return !!(active && !active.paused && !active.unlockedEarly);
  }

  function nativePlugin() {
    const cap = window.Capacitor;
    if (!cap || typeof cap.registerPlugin !== 'function') return null;
    if (typeof cap.getPlatform === 'function' && cap.getPlatform() !== 'ios') return null;
    try { return cap.registerPlugin('FocusLock'); } catch { return null; }
  }

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };

  /** The controller. `plugin` and `ask` are injectable for tests. */
  function create({ plugin = nativePlugin(), ask = askToSetUp } = {}) {
    let applied = null;   // 'locked' | 'unlocked' | null (nothing applied yet this page)
    let queue = Promise.resolve();
    const listeners = [];

    async function ensureSetup() {
      const st = await plugin.status();
      if (!st || !st.supported) return false;
      if (st.authorized && st.appsChosen > 0) return true;
      if (store.get(DECLINED)) return false;
      if (!(await ask())) { store.set(DECLINED, '1'); return false; }
      const r = await plugin.setup();
      if (!r || !(r.appsChosen > 0)) { store.set(DECLINED, '1'); return false; }
      return true;
    }

    // `applied` is the last answer acted on, so a declined set-up isn't asked again on every save.
    async function apply(want) {
      if (want === applied) return;
      applied = want;
      if (want === 'locked') {
        const r = (await ensureSetup()) ? await plugin.lock() : null;
        notify(!!(r && r.locked));
      } else {
        await plugin.unlock();
        notify(false);
      }
    }

    let blocked = false;
    function notify(on) { blocked = on; listeners.forEach((f) => { try { f(on); } catch {} }); }

    return {
      available: () => !!plugin,
      /** True while the apps are actually blocked. */
      get locked() { return blocked; },
      onChange(f) { listeners.push(f); },
      /** Bring the block in line with this workout draft. Resolves once applied. */
      sync(active) {
        if (!plugin) return Promise.resolve();
        const want = shouldLock(active) ? 'locked' : 'unlocked';
        queue = queue.then(() => apply(want)).catch((err) => { applied = null; console.warn('lock-in:', err && err.message); });
        return queue;
      },
      /** Let the user pick the apps again (Settings), clearing an earlier "not now". */
      async choose() {
        if (!plugin) return 0;
        try { localStorage.removeItem(DECLINED); } catch {}
        const r = await plugin.setup();
        return (r && r.appsChosen) || 0;
      },
    };
  }

  // ── UI ───────────────────────────────────────────────────────────────
  function injectStyle() {
    if (document.getElementById('focuslock-css')) return;
    const s = document.createElement('style');
    s.id = 'focuslock-css';
    s.textContent = `
.fl-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:10px 0 0;padding:10px 12px;border:1px solid var(--bd,#E3E5E8);border-radius:12px;font-size:12.5px;color:var(--t2,#5B6068)}
.fl-row b{color:var(--t1,#16181D);font-weight:600}
.fl-hold{position:relative;overflow:hidden;flex:none;font:inherit;font-size:12px;font-weight:600;color:var(--t1,#16181D);background:var(--s1,#F4F5F7);border:0;border-radius:999px;padding:7px 14px;touch-action:none;user-select:none;-webkit-user-select:none;cursor:pointer}
.fl-hold i{position:absolute;inset:0;width:0;background:rgba(192,64,58,.18);pointer-events:none}
.fl-hold.on i{width:100%;transition:width ${HOLD_MS}ms linear}
.fl-hold span{position:relative}
.fl-sheet{position:fixed;inset:0;z-index:9999;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.35)}
.fl-card{width:100%;max-width:440px;background:var(--bg,#fff);color:var(--t1,#16181D);border-radius:20px 20px 0 0;padding:24px 22px calc(22px + env(safe-area-inset-bottom));box-shadow:0 -10px 40px rgba(0,0,0,.15)}
.fl-card h3{margin:0 0 8px;font-size:19px;letter-spacing:-.01em}
.fl-card p{margin:0 0 16px;font-size:14px;line-height:1.45;color:var(--t2,#5B6068)}
.fl-card .fl-btns{display:flex;gap:10px}
.fl-card button{flex:1;font:inherit;font-size:15px;font-weight:600;border:0;border-radius:12px;padding:13px}
.fl-card .fl-go{background:var(--t1,#16181D);color:var(--bg,#fff)}
.fl-card .fl-no{background:var(--s1,#F4F5F7);color:var(--t1,#16181D)}`;
    document.head.appendChild(s);
  }

  /** The one-time explanation before Apple's permission prompt and app picker. Resolves true to go ahead. */
  function askToSetUp() {
    injectStyle();
    return new Promise((resolve) => {
      const el = document.createElement('div');
      el.className = 'fl-sheet';
      el.innerHTML = `<div class="fl-card" role="dialog" aria-modal="true" aria-labelledby="fl-t">
        <h3 id="fl-t">Lock in</h3>
        <p>Every workout blocks your distracting apps until you finish. Next, allow Screen Time and tick <b>Instagram, TikTok, YouTube and Snapchat</b> (or any others).</p>
        <div class="fl-btns"><button class="fl-no">Not now</button><button class="fl-go">Choose apps</button></div></div>`;
      const done = (v) => { el.remove(); resolve(v); };
      el.querySelector('.fl-go').onclick = () => done(true);
      el.querySelector('.fl-no').onclick = () => done(false);
      document.body.appendChild(el);
    });
  }

  /** "Apps locked" with a hold-to-unlock button, into `host` (emptied when nothing is blocked). */
  function render(host, onUnlock) {
    if (!host) return;
    if (!FocusLock.locked) { host.innerHTML = ''; return; }
    injectStyle();
    host.innerHTML = `<div class="fl-row"><span>🔒 <b>Apps locked</b> until you finish</span>
      <button class="fl-hold" aria-label="Hold for 5 seconds to unlock your apps"><i></i><span>Hold to unlock</span></button></div>`;
    const b = host.querySelector('.fl-hold'), label = b.querySelector('span');
    let timer = null;
    const cancel = () => { clearTimeout(timer); timer = null; b.classList.remove('on'); label.textContent = 'Hold to unlock'; };
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { b.setPointerCapture(e.pointerId); } catch {}
      b.classList.add('on'); label.textContent = 'Keep holding…';
      timer = setTimeout(() => { timer = null; b.classList.remove('on'); onUnlock(); }, HOLD_MS);
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => b.addEventListener(ev, () => { if (timer) cancel(); }));
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  const FocusLock = typeof window !== 'undefined' && window.document ? create() : null;
  const api = { shouldLock, create, HOLD_MS };
  if (FocusLock) { FocusLock.render = render; window.FocusLock = FocusLock; }
  if (typeof window !== 'undefined') window.FocusLockLib = api;
})();
