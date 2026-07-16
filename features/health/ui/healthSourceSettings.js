// Source preferences UI — one preferred source per metric.
// Rendered into a container by connectedHealth.js.

import { METRICS, getPreferences, setPreference } from '../services/healthSourcePreferences.js';
import { connectedProviderIds, applyAll } from '../services/healthDataService.js';

const NAMES = {
  auto: 'Automatic (best available)',
  arete: 'Arete (manual)',
  apple_health: 'Apple Health',
  health_connect: 'Health Connect',
  oura: 'Oura',
  whoop: 'WHOOP',
  fitbit: 'Fitbit',
  garmin: 'Garmin',
  polar: 'Polar',
  withings: 'Withings',
  samsung_health: 'Samsung Health',
};

export function renderSourceSettings(container) {
  const prefs = getPreferences();
  const connected = connectedProviderIds();
  const options = ['auto', 'arete', ...connected];
  container.innerHTML = `
    <div style="font-size:12px;color:#6E6E73;line-height:1.55;margin-bottom:12px">
      One source feeds each metric — Arete never adds totals from several
      providers together. “Automatic” picks the best connected source.
    </div>
    ${METRICS.map((m) => `
      <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid rgba(0,0,0,.06)">
        <span style="flex:1;font-size:13px;font-weight:600">${m.label}</span>
        <select data-metric="${m.key}" style="padding:8px 10px;border-radius:9px;border:1px solid rgba(0,0,0,.1);font-size:12.5px;background:#fff;max-width:210px">
          ${options.map((o) => `<option value="${o}" ${prefs[m.key] === o ? 'selected' : ''}>${NAMES[o] || o}</option>`).join('')}
        </select>
      </div>`).join('')}`;
  container.querySelectorAll('select').forEach((sel) => {
    sel.onchange = () => {
      setPreference(sel.dataset.metric, sel.value);
      applyAll(); // re-route stored records through the new preference
    };
  });
}
