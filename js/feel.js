/* ============================================================================
 *  Feel: physical motion for the whole app (loaded on every page).
 *
 *  Press: every button shrinks to 96% while it's held and springs back when
 *  it's let go, with a touch of overshoot. Wide rows and list items shrink
 *  less (98.5%), so a full-width row doesn't jump.
 *  Numbers: when a number on screen changes, each digit that changed rolls
 *  to its new value (up when the number grows, down when it shrinks) instead
 *  of swapping. Works for numbers whose text is updated in place, and for
 *  numbers in sections that are redrawn: give those a stable name with
 *  data-roll="…" and they roll from the value they last showed.
 *
 *  Motion comes from a real spring (stiffness, damping, mass), simulated and
 *  played with the Web Animations API, so things speed up and settle like
 *  objects do. Skipped entirely when the device asks for reduced motion.
 * ==========================================================================*/
(function () {
  if (window.Feel) return;
  const reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const can = typeof Element !== 'undefined' && Element.prototype.animate;

  // ── Spring ────────────────────────────────────────────────────────────────
  /** Positions of a damped spring from `from` to `to`, one per 60 fps frame, until it settles. */
  function spring(from, to, { stiffness = 400, damping = 26, mass = 1, velocity = 0 } = {}) {
    const out = [from], sub = 8, dt = 1 / 60 / sub;
    let x = from, v = velocity;
    const span = Math.abs(to - from) || 1;
    for (let f = 0; f < 120; f++) { // at most 2 s
      for (let i = 0; i < sub; i++) { const a = (-stiffness * (x - to) - damping * v) / mass; v += a * dt; x += v * dt; }
      out.push(x);
      if (Math.abs(x - to) < span * 0.002 && Math.abs(v) < span * 0.05) break;
    }
    out[out.length - 1] = to;
    return { values: out, duration: (out.length - 1) * (1000 / 60) };
  }
  const SPRINGS = {
    press: { stiffness: 900, damping: 44 },   // in fast, no wobble
    release: { stiffness: 380, damping: 15 }, // back out with a little overshoot
    roll: { stiffness: 320, damping: 26 },    // digits: quick, settles cleanly
  };

  // ── Press ─────────────────────────────────────────────────────────────────
  const PRESS = ['button', '.btn', '[role="button"]', 'input[type="button"]', 'input[type="submit"]', 'summary',
    '.ni', '.mob-item', '.tab', '.chip', '.ei-ct', '.ei-obs-btn', '.meal-add', '.water-btn', '.jstep-btn', '.icon-btn',
    '.mood-btn', '.pill', '.seg', '.seg-btn', '.wtab', '.td-go', '.ag', '.rcc-list a', '.li', '.th', '.ib', '.streak', 'a[href]', 'label[for]'].join(',');
  const ROWS = '.ni, .mob-item, .td-go, .rcc-list a, .li, summary';
  function scaleOf(el) { const s = parseFloat(getComputedStyle(el).scale); return Number.isFinite(s) ? s : 1; }
  function toScale(el, to, cfg) {
    const { values, duration } = spring(scaleOf(el), to, cfg);
    if (el.__feel) el.__feel.cancel();
    const a = el.animate(values.map((s) => ({ scale: String(s) })), { duration: Math.max(16, duration), fill: 'forwards', easing: 'linear' });
    el.__feel = a;
    if (to === 1) a.onfinish = () => { if (el.__feel === a) { a.cancel(); el.__feel = null; } };
  }
  let held = null;
  // Anything wide (a full-width card or row) shrinks less, so it doesn't jump.
  function press(el) { held = el; toScale(el, el.matches(ROWS) || el.getBoundingClientRect().width > 0.6 * innerWidth ? 0.985 : 0.96, SPRINGS.press); }
  function release() { if (held) { toScale(held, 1, SPRINGS.release); held = null; } }
  function target(e) {
    const el = e.target && e.target.closest ? e.target.closest(PRESS) : null;
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true' || el.closest('[data-no-press]')) return null;
    // A link inside a sentence stays still; links shaped like buttons and cards press.
    if ((el.tagName === 'A' || el.tagName === 'LABEL') && getComputedStyle(el).display === 'inline') return null;
    return el;
  }
  if (can) {
    document.addEventListener('pointerdown', (e) => { if (reduce.matches || e.button > 0) return; const el = target(e); if (el) press(el); }, { capture: true, passive: true });
    ['pointerup', 'pointercancel', 'dragstart'].forEach((t) => window.addEventListener(t, release, { capture: true, passive: true }));
    document.addEventListener('pointerout', (e) => { if (held && e.target === held && !held.contains(e.relatedTarget)) release(); }, { capture: true, passive: true });
    document.addEventListener('keydown', (e) => { if (reduce.matches || e.repeat || (e.key !== ' ' && e.key !== 'Enter')) return; const el = target(e); if (el && el === document.activeElement) press(el); }, true);
    document.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') release(); }, true);
    document.documentElement.classList.add('spring');
  }

  // ── Rolling numbers ───────────────────────────────────────────────────────
  const NUMERIC = /^[^\d\n]{0,4}\d[\d.,:\s  /×x+\-−]*[^\d\n]{0,8}$/;
  const isNum = (t) => typeof t === 'string' && t.length <= 24 && /\d/.test(t) && NUMERIC.test(t.trim());
  const valueOf = (t) => parseFloat(String(t).replace(/[^\d.\-−]/g, '').replace('−', '-'));
  const memory = new Map();       // data-roll name → text it last showed
  const lastAt = new WeakMap();   // element → time of its last change

  // The element keeps its real text the whole time (code that reads it back always gets the true value);
  // the roll is drawn in a layer placed exactly over that text, which is hidden until the roll lands.
  function finish(el) {
    const r = el.__roll; if (!r) return;
    r.layer.remove(); el.style.color = r.color; el.__roll = null;
  }
  function roll(el, from, to) {
    if (reduce.matches || !can || !el.isConnected) return;
    finish(el);
    const now = performance.now(), prev = lastAt.get(el) || 0;
    lastAt.set(el, now);
    if (now - prev < 140) return; // ticking faster than a roll (a count-up, a live readout): let it tick
    const tn = el.firstChild;
    if (!tn || tn.nodeType !== 3 || el.childNodes.length !== 1) return;
    const range = document.createRange(); range.selectNodeContents(tn);
    const box = range.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const up = !(valueOf(to) < valueOf(from));
    const n = Math.max(from.length, to.length), a = from.padStart(n, ' '), b = to.padStart(n, ' ');
    const layer = document.createElement('span');
    layer.className = 'feel-roll';
    layer.setAttribute('aria-hidden', 'true');
    let longest = 0, k = 0;
    for (let i = 0; i < n; i++) {
      if (a[i] === b[i]) { if (b[i] !== ' ' || i >= n - to.length) layer.append(b[i]); continue; }
      const cell = document.createElement('span'), o = document.createElement('span'), w = document.createElement('span');
      cell.className = 'feel-roll-c'; o.textContent = a[i] === ' ' ? '' : a[i]; w.textContent = b[i] === ' ' ? '' : b[i];
      cell.append(o, w); layer.append(cell);
      const { values, duration } = spring(0, 1, SPRINGS.roll), dir = up ? -1 : 1, delay = (k++) * 28;
      o.animate(values.map((p) => ({ transform: `translateY(${p * dir * 100}%)`, opacity: String(1 - Math.min(1, p * 1.2)) })), { duration, delay, fill: 'both', easing: 'linear' });
      w.animate(values.map((p) => ({ transform: `translateY(${(1 - p) * -dir * 100}%)`, opacity: String(Math.min(1, p * 1.3)) })), { duration, delay, fill: 'both', easing: 'linear' });
      longest = Math.max(longest, duration + delay);
    }
    if (!k) return;
    const cs = getComputedStyle(el);
    Object.assign(layer.style, { position: 'absolute', top: `${box.top + scrollY}px`, left: `${box.left + scrollX}px`, height: `${box.height}px`, lineHeight: `${box.height}px`,
      fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontStyle: cs.fontStyle, fontStretch: cs.fontStretch,
      fontVariantNumeric: cs.fontVariantNumeric, fontFeatureSettings: cs.fontFeatureSettings, letterSpacing: cs.letterSpacing,
      color: cs.color, pointerEvents: 'none', zIndex: '60' });
    document.body.appendChild(layer);
    layer.style.left = `${box.right + scrollX - layer.getBoundingClientRect().width}px`; // right-aligned, like the digits
    el.__roll = { layer, color: el.style.color };
    el.style.color = 'transparent';
    setTimeout(() => { if (el.__roll && el.__roll.layer === layer) finish(el); }, longest + 30);
  }

  function seenNamed(el) {
    const key = el.dataset.roll, t = el.textContent;
    const before = memory.get(key);
    memory.set(key, t);
    if (before != null && before !== t && isNum(before) && isNum(t)) roll(el, before, t);
  }
  const skip = (el) => !el || !el.closest || el.closest('input, textarea, select, [contenteditable], svg, [data-no-roll], .feel-roll');

  function onMutations(list) {
    for (const m of list) {
      let el = null, from = null, to = null;
      if (m.type === 'characterData') { el = m.target.parentElement; from = m.oldValue; to = m.target.data; }
      else if (m.type === 'childList') {
        // textContent = "…" on an element that held only text
        if (m.removedNodes.length === 1 && m.addedNodes.length === 1 && m.removedNodes[0].nodeType === 3 && m.addedNodes[0].nodeType === 3 && m.target.nodeType === 1) {
          el = m.target; from = m.removedNodes[0].data; to = m.addedNodes[0].data;
        } else {
          // Redrawn sections: named numbers roll from the value they last showed.
          m.addedNodes.forEach((nd) => {
            if (nd.nodeType !== 1) return;
            if (nd.matches('[data-roll]')) seenNamed(nd);
            nd.querySelectorAll('[data-roll]').forEach(seenNamed);
          });
          continue;
        }
      }
      if (!el || skip(el)) continue;
      if (el.__roll && el.textContent !== to) finish(el); // rewritten mid-roll: drop the old roll
      if (el.childNodes.length !== 1) continue;
      if (el.dataset && el.dataset.roll) memory.set(el.dataset.roll, to);
      if (from === to || !isNum(from) || !isNum(to)) continue;
      roll(el, from, to);
    }
  }

  function start() {
    document.querySelectorAll('[data-roll]').forEach((el) => memory.set(el.dataset.roll, el.textContent));
    new MutationObserver(onMutations).observe(document.documentElement, { subtree: true, childList: true, characterData: true, characterDataOldValue: true });
  }

  // ── Styles ────────────────────────────────────────────────────────────────
  const css = `
html.spring :is(${PRESS}):active { transform: none !important; }
.feel-roll { display: inline-block; white-space: pre; }
.feel-roll-c { display: inline-grid; overflow: hidden; vertical-align: top; height: 100%; }
.feel-roll-c > span { grid-area: 1 / 1; text-align: center; }
`;
  function addStyle() { const s = document.createElement('style'); s.id = 'feel-css'; s.textContent = css; document.head.appendChild(s); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { addStyle(); start(); });
  else { addStyle(); start(); }

  window.Feel = { spring, roll, SPRINGS };
})();
