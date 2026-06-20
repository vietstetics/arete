// Permission + privacy + manual-entry panel.
// Shows the rationale BEFORE the system permission screen, the required
// disclosure, and a clearly-labelled manual fallback.
import { injectStepStyles } from './stepStyles.js';
import { DISCLOSURE } from './stepProgress.js';
import { todayKey } from '../util/date.js';

const PRIVACY = 'JARVIS reads your phone’s motion / Health Connect step data to count your daily steps. Only daily step totals are stored on your device — raw motion is never uploaded.';

export function renderPermission(target, opts = {}) {
  injectStepStyles();
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  if (!el) return;
  const state = opts.state; // 'needs-permission' | 'denied' | 'unavailable' | 'granted'

  if (state === 'granted') {
    el.innerHTML = `<div class="jstep-panel">
      <h3>Step tracking is on</h3>
      <p>${DISCLOSURE}</p>
    </div>`;
    return;
  }

  if (state === 'needs-permission') {
    el.innerHTML = `<div class="jstep-panel">
      <h3>Turn on phone step tracking</h3>
      <p>${PRIVACY}</p>
      <p style="color:var(--t3,#86868b)">${DISCLOSURE}</p>
      <button class="jstep-btn primary" data-act="enable" style="flex:none;width:100%">Enable step tracking</button>
    </div>`;
    const btn = el.querySelector('[data-act="enable"]');
    if (btn && opts.onEnable) btn.addEventListener('click', () => opts.onEnable());
    return;
  }

  // denied or unavailable -> manual entry
  const reason = state === 'unavailable'
    ? 'This device has no phone step counter.'
    : 'Step permission is off, so steps can’t be read automatically.';
  el.innerHTML = `<div class="jstep-panel">
    <h3>Enter steps manually</h3>
    <p>${reason} You can record today’s steps yourself — they’ll be saved and clearly labelled as manual.</p>
    <div class="jstep-row">
      <input class="jstep-input" type="number" inputmode="numeric" min="0" step="1" placeholder="Today’s steps" data-field="manual" />
      <button class="jstep-btn primary" data-act="save" style="flex:none">Save</button>
    </div>
    ${state === 'denied' ? '<p style="margin:10px 0 0;color:var(--t3,#86868b)">Tip: you can re-enable automatic tracking in your phone’s settings.</p>' : ''}
  </div>`;
  const input = el.querySelector('[data-field="manual"]');
  const save = el.querySelector('[data-act="save"]');
  if (save && opts.onManual) {
    save.addEventListener('click', () => {
      const v = parseInt(input.value, 10);
      if (Number.isFinite(v) && v >= 0) { opts.onManual(todayKey(), v); input.value = ''; }
    });
  }
}

export { PRIVACY };
