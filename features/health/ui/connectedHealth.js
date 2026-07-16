// Connected Health screen controller (vanilla JS, ES module).
// Platform-aware provider list, per-card connect / sync / disconnect,
// pre-permission primer, sleep confirmation, and source preferences.

import { platform } from '../native/healthPlugin.js';
import { healthRepository } from '../repositories/healthRepository.js';
import { appleHealthAdapter } from '../providers/appleHealthAdapter.js';
import { healthConnectAdapter } from '../providers/healthConnectAdapter.js';
import {
  ouraAdapter, whoopAdapter, fitbitAdapter,
  garminAdapter, polarAdapter, withingsAdapter, samsungHealthAdapter,
} from '../providers/cloudAdapters.js';
import { createSyncService, installAutoSync } from '../services/healthSyncService.js';
import { applyAll, pendingSleepSuggestion, resolveSleepSuggestion } from '../services/healthDataService.js';
import { showPermissionPrimer } from './healthPermissionDialog.js';
import { renderSourceSettings } from './healthSourceSettings.js';

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function adaptersForPlatform() {
  const plat = platform();
  const cloud = [ouraAdapter, whoopAdapter, fitbitAdapter, garminAdapter, polarAdapter, withingsAdapter];
  if (plat === 'android') return [healthConnectAdapter, ...cloud, samsungHealthAdapter];
  if (plat === 'ios') return [appleHealthAdapter, ...cloud];
  // plain web: show both platform hubs greyed with honest copy + cloud rows
  return [appleHealthAdapter, healthConnectAdapter, ...cloud, samsungHealthAdapter];
}

const TYPE_LABEL = {
  steps: 'Steps', sleep: 'Sleep', workout: 'Workouts', active_calories: 'Active kcal',
  distance: 'Distance', heart_rate: 'Heart rate', resting_heart_rate: 'Resting HR',
  hrv: 'HRV', weight: 'Weight', body_fat: 'Body fat',
};

let sync;

export async function mountConnectedHealth(root) {
  const adapters = adaptersForPlatform();
  sync = createSyncService(adapters.filter((a) => !a.comingSoon && !a.info.viaConnections));

  root.innerHTML = `
    <div id="hlt-sleep-banner"></div>
    <div id="hlt-cards"></div>
    <div class="grp-h" style="font-size:12px;font-weight:700;color:#AEAEB2;text-transform:uppercase;letter-spacing:.05em;margin:26px 0 12px">Source preferences</div>
    <div class="card" style="padding:16px 18px" id="hlt-prefs"></div>`;

  await renderCards(root, adapters);
  renderSourceSettings(root.querySelector('#hlt-prefs'));
  renderSleepBanner(root);

  installAutoSync({ syncAll: async () => { const r = await sync.syncAll(); await renderCards(root, adapters); renderSleepBanner(root); return r; } });
}

function renderSleepBanner(root) {
  const host = root.querySelector('#hlt-sleep-banner');
  const s = pendingSleepSuggestion();
  if (!s) { host.innerHTML = ''; return; }
  const h = Math.floor(s.minutes / 60), m = s.minutes % 60;
  const name = s.provider === 'apple_health' ? 'Apple Health' : s.provider === 'health_connect' ? 'Health Connect' : s.provider;
  host.innerHTML = `
    <div class="card" style="padding:15px 18px;margin-bottom:16px;border-color:rgba(29,164,98,.25)">
      <div style="font-size:13px;font-weight:700;margin-bottom:4px">${esc(name)} detected ${h} h ${m} min of sleep</div>
      <div style="font-size:12px;color:#6E6E73;margin-bottom:11px">Use this for last night? Your own answer is never replaced without asking.</div>
      <div style="display:flex;gap:8px">
        <button id="hlt-sleep-yes" style="flex:1;padding:10px;border-radius:10px;border:none;background:#1DA462;color:#fff;font-size:12.5px;font-weight:700;cursor:pointer">Use detected value</button>
        <button id="hlt-sleep-no" style="flex:1;padding:10px;border-radius:10px;border:1px solid rgba(0,0,0,.1);background:#fff;font-size:12.5px;font-weight:700;cursor:pointer">Keep my answer</button>
      </div>
    </div>`;
  host.querySelector('#hlt-sleep-yes').onclick = () => { resolveSleepSuggestion(true); renderSleepBanner(root); };
  host.querySelector('#hlt-sleep-no').onclick = () => { resolveSleepSuggestion(false); renderSleepBanner(root); };
}

async function renderCards(root, adapters) {
  const host = root.querySelector('#hlt-cards');
  const cards = await Promise.all(adapters.map(async (a) => {
    const [status, caps, available] = await Promise.all([
      a.getConnectionStatus(), a.getCapabilities(), a.isAvailable(),
    ]);
    return { a, status, caps, available };
  }));
  host.innerHTML = `<div class="conn-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:14px">
    ${cards.map(({ a, status, caps, available }) => card(a, status, caps, available)).join('')}
  </div>`;
  host.querySelectorAll('[data-act]').forEach((btn) => {
    btn.onclick = () => handleAction(root, adapters, btn.dataset.act, btn.dataset.p);
  });
}

function card(a, status, caps, available) {
  const connected = status.state === 'connected';
  const soon = !!a.comingSoon;
  const via = !!a.info.viaConnections;
  const badge = connected
    ? '<span style="font-size:11px;font-weight:700;padding:5px 11px;border-radius:999px;background:rgba(29,164,98,.1);color:#1DA462">Connected</span>'
    : soon ? '<span style="font-size:11px;font-weight:700;padding:5px 11px;border-radius:999px;background:rgba(0,0,0,.05);color:#AEAEB2">Coming soon</span>'
    : available ? '<span style="font-size:11px;font-weight:700;padding:5px 11px;border-radius:999px;background:rgba(94,92,230,.1);color:#5E5CE6">Ready</span>'
    : '<span style="font-size:11px;font-weight:700;padding:5px 11px;border-radius:999px;background:rgba(0,0,0,.05);color:#AEAEB2">' + (via ? 'Via Connections' : 'In the app') + '</span>';

  const last = status.lastSyncAt
    ? 'Last sync ' + new Date(status.lastSyncAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'Never synced';

  let actions = '';
  if (soon) actions = '';
  else if (via) actions = `<a href="connections.html" style="display:block;text-align:center;padding:10px;border-radius:10px;border:1px solid rgba(0,0,0,.1);font-size:12.5px;font-weight:700;color:#1D1D1F;text-decoration:none">Open Connections</a>`;
  else if (connected) actions = `
    <div style="display:flex;gap:8px">
      <button data-act="sync" data-p="${a.provider}" style="flex:1;padding:10px;border-radius:10px;border:none;background:#1D1D1F;color:#fff;font-size:12.5px;font-weight:700;cursor:pointer">Sync now</button>
      <button data-act="disconnect" data-p="${a.provider}" style="padding:10px 14px;border-radius:10px;border:1px solid rgba(0,0,0,.1);background:#fff;color:#C0403A;font-size:12.5px;font-weight:700;cursor:pointer">Disconnect</button>
    </div>`;
  else if (available) actions = `<button data-act="connect" data-p="${a.provider}" style="width:100%;padding:11px;border-radius:10px;border:none;background:#1D1D1F;color:#fff;font-size:12.5px;font-weight:700;cursor:pointer">Connect</button>`;
  else actions = `<div style="font-size:11.5px;color:#AEAEB2;text-align:center;padding:6px">${a.provider === 'apple_health' ? 'Available in the iPhone app' : a.provider === 'health_connect' ? 'Available in the Android app' : ''}</div>`;

  return `<div class="card" style="padding:18px">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <div style="font-size:15px;font-weight:700;flex:1">${esc(a.info.name)}</div>
      ${badge}
    </div>
    <div style="font-size:12.5px;color:#6E6E73;line-height:1.55;margin-bottom:10px">${esc(a.info.description)}</div>
    <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px">
      ${caps.map((c) => `<span style="font-size:10.5px;font-weight:600;padding:3px 9px;border-radius:7px;background:rgba(0,0,0,.05);color:#6E6E73">${TYPE_LABEL[c] || c}</span>`).join('')}
    </div>
    <div style="font-size:11px;color:#AEAEB2;margin-bottom:11px">${esc(last)}${status.lastError ? ` · <span style="color:#B07D28">${esc(status.lastError)}</span>` : ''}</div>
    ${actions}
  </div>`;
}

async function handleAction(root, adapters, act, providerId) {
  const adapter = adapters.find((a) => a.provider === providerId);
  if (!adapter) return;
  const rerender = async () => { await renderCards(root, adapters); renderSourceSettings(root.querySelector('#hlt-prefs')); renderSleepBanner(root); };
  try {
    if (act === 'connect') {
      showPermissionPrimer(adapter.info.name, async (days) => {
        try {
          await adapter.connect();
          const c = healthRepository.getConnection(providerId);
          healthRepository.setConnection({ ...c, historyDays: days });
          await sync.syncProvider(providerId);   // sync right after connecting
          applyAll();
          await rerender();
        } catch (e) { alert((e && e.message) || 'Couldn’t connect.'); await rerender(); }
      });
    } else if (act === 'sync') {
      await sync.syncProvider(providerId);
      applyAll();
      await rerender();
    } else if (act === 'disconnect') {
      if (!confirm('Disconnect ' + adapter.info.name + '? Imported data stays until you clear it.')) return;
      await adapter.disconnect();
      await rerender();
    }
  } catch (e) {
    alert((e && e.message) || 'Something went wrong.');
  }
}
