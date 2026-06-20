// Dashboard step card: ring (%), today/goal, remaining, 7-day average, streak.
import { injectStepStyles } from './stepStyles.js';

const DISCLOSURE = 'Steps are recorded when you carry your phone. Steps taken while your phone is left behind may not be counted.';

function fmt(n) { return (n || 0).toLocaleString(); }

export function renderStepCard(target, model, handlers = {}) {
  injectStepStyles();
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  if (!el) return;

  const pct = Math.max(0, Math.min(100, model.percent || 0));
  const r = 36, C = 2 * Math.PI * r;
  const off = C * (1 - pct / 100);
  const manualBadge = model.source === 'manual' ? '<span class="jstep-badge">Manual</span>' : '';
  const remClass = model.remaining <= 0 ? 'jstep-rem done' : 'jstep-rem';
  const remText = model.remaining <= 0
    ? 'Goal reached — nice work'
    : `${fmt(model.remaining)} steps remaining`;

  el.innerHTML = `
    <div class="jstep-h">
      <span class="jstep-title">Steps</span>${manualBadge}
    </div>
    <div class="jstep-top">
      <div class="jstep-ring">
        <svg width="84" height="84" viewBox="0 0 84 84">
          <circle cx="42" cy="42" r="${r}" fill="none" stroke="var(--s4,#ececec)" stroke-width="7"/>
          <circle cx="42" cy="42" r="${r}" fill="none" stroke="var(--gr,#1da462)" stroke-width="7"
            stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/>
        </svg>
        <div class="jstep-pct">${pct}%</div>
      </div>
      <div class="jstep-nums">
        <div class="jstep-big">${fmt(model.today)} <span>/ ${fmt(model.goal)}</span></div>
        <div class="${remClass}">${remText}</div>
      </div>
    </div>
    <div class="jstep-stats">
      <div class="jstep-stat"><div class="v">${fmt(model.sevenDayAverage)}</div><div class="l">7-day average</div></div>
      <div class="jstep-stat"><div class="v">${model.streak} ${model.streak === 1 ? 'day' : 'days'}</div><div class="l">Current streak</div></div>
    </div>
    <div class="jstep-note">${DISCLOSURE}</div>
    <div class="jstep-actions">
      <a class="jstep-btn" href="steps.html">History</a>
      ${handlers.onManual ? '<button class="jstep-btn" data-act="manual">Enter manually</button>' : ''}
    </div>
  `;

  const man = el.querySelector('[data-act="manual"]');
  if (man && handlers.onManual) man.addEventListener('click', handlers.onManual);
}

export { DISCLOSURE };
