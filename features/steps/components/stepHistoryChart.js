// History view: 7-day bar graph + weekly average, monthly total, best day,
// goal-completion days, and a daily list.
import { injectStepStyles } from './stepStyles.js';
import { dateFromKey } from '../util/date.js';

function fmt(n) { return (n || 0).toLocaleString(); }
function dayLabel(key) {
  return dateFromKey(key).toLocaleDateString(undefined, { weekday: 'short' });
}
function fullLabel(key) {
  return dateFromKey(key).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function renderHistory(target, model) {
  injectStepStyles();
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  if (!el) return;

  const max = Math.max(model.goal || 1, ...model.series.map((d) => d.steps), 1);
  const bars = model.series
    .map((d) => {
      const h = Math.max(4, Math.round((d.steps / max) * 100));
      return `<div class="jstep-col">
        <div class="jstep-bar ${d.metGoal ? 'met' : ''}" style="height:${h}%" title="${fmt(d.steps)} steps"></div>
        <div class="d">${dayLabel(d.date)}</div>
      </div>`;
    })
    .join('');

  const best = model.bestDay && model.bestDay.date
    ? `${fmt(model.bestDay.steps)}<div class="l">Best day · ${fullLabel(model.bestDay.date)}</div>`
    : `—<div class="l">Best day</div>`;

  const list = model.series
    .slice()
    .reverse()
    .map((d) => `
      <div class="jstep-row" style="justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--bd,#eee)">
        <span style="font-size:13px;color:var(--t2,#6e6e73)">${fullLabel(d.date)}</span>
        <span style="font-size:13px;font-weight:600;color:${d.metGoal ? 'var(--gr,#1da462)' : 'var(--t1,#1d1d1f)'}">${fmt(d.steps)}</span>
      </div>`)
    .join('');

  el.innerHTML = `
    <div class="jstep-panel">
      <h3>Last 7 days</h3>
      <div class="jstep-bars">${bars}</div>
      <div class="jstep-tiles">
        <div class="jstep-tile"><div class="v">${fmt(model.weeklyAverage)}</div><div class="l">Weekly average</div></div>
        <div class="jstep-tile"><div class="v">${fmt(model.monthlyTotal)}</div><div class="l">This month</div></div>
        <div class="jstep-tile"><div class="v">${best}</div></div>
        <div class="jstep-tile"><div class="v">${model.goalCompletionDays}</div><div class="l">Goal-completion days</div></div>
      </div>
      <div style="margin-top:16px">${list}</div>
    </div>
  `;
}
