// Bootstrap that wires the repository, the phone step service, the sync
// service, and the UI components. The phone sensor is the source of truth; the
// repository only persists daily totals for display/history.

import { createStepRepository } from './repositories/stepRepository.js';
import { getStepService } from './services/stepTrackingService.js';
import { createStepSyncService } from './services/stepSyncService.js';
import { dashboardStats, historyStats } from './services/stepStats.js';
import { todayKey } from './util/date.js';
import { renderStepCard } from './components/stepProgress.js';
import { renderHistory } from './components/stepHistoryChart.js';
import { renderPermission } from './components/stepPermissionCard.js';

const PERM_KEY = 'jarvis_steps_perm'; // 'granted' | 'denied' | 'unset'

const repo = createStepRepository();
const service = getStepService(repo);
const sync = createStepSyncService(service, repo);

function getPerm() { try { return localStorage.getItem(PERM_KEY) || 'unset'; } catch { return 'unset'; } }
function setPerm(v) { try { localStorage.setItem(PERM_KEY, v); } catch {} }

function cardModel() {
  const goal = repo.getGoal();
  return { ...dashboardStats(repo.all(), goal, todayKey()), source: service.source };
}

/** 'granted' | 'needs-permission' | 'denied' | 'unavailable' */
async function resolveState() {
  if (!service.isNative) return 'unavailable';
  if (!(await service.isAvailable())) return 'unavailable';
  const perm = getPerm();
  if (perm === 'granted') return 'granted';
  if (perm === 'denied') return 'denied';
  return 'needs-permission';
}

// Pull recent history + today from the phone, then keep today live.
async function pullAndLive(rerender, days) {
  await sync.syncHistory(days);
  await sync.syncToday();
  rerender();
  try { await sync.startLive(() => rerender()); } catch {}
}

async function requestThenSync(rerender, days, onResult) {
  const granted = await service.requestPermission();
  setPerm(granted ? 'granted' : 'denied');
  if (granted) await pullAndLive(rerender, days);
  onResult(granted ? 'granted' : 'denied');
}

// ── Dashboard card + panel ──────────────────────────────────────────────
export async function mountDashboard({ card, panel }) {
  const rerender = () => renderStepCard(card, cardModel());
  rerender();

  const panelEl = typeof panel === 'string' ? document.querySelector(panel) : panel;
  const hidePanel = () => { if (panelEl) panelEl.style.display = 'none'; };
  const showManual = () => renderPermission(panel, {
    state: getPerm() === 'denied' ? 'denied' : 'unavailable',
    onManual: (d, s) => { sync.saveManual(d, s); rerender(); },
  });

  const state = await resolveState();
  if (state === 'granted') { hidePanel(); await pullAndLive(rerender, 60); }
  else if (state === 'needs-permission') {
    renderPermission(panel, {
      state,
      onEnable: () => requestThenSync(rerender, 60, (res) => {
        if (res === 'granted') hidePanel(); else showManual();
      }),
    });
  } else showManual();
}

// ── Steps history page ──────────────────────────────────────────────────
export async function mountStepsPage({ history, panel }) {
  const rerender = () => renderHistory(history, historyStats(repo.all(), repo.getGoal(), todayKey()));
  rerender();

  const showManual = () => renderPermission(panel, {
    state: getPerm() === 'denied' ? 'denied' : 'unavailable',
    onManual: (d, s) => { sync.saveManual(d, s); rerender(); },
  });

  const state = await resolveState();
  if (state === 'granted') { renderPermission(panel, { state }); await pullAndLive(rerender, 90); }
  else if (state === 'needs-permission') {
    renderPermission(panel, {
      state,
      onEnable: () => requestThenSync(rerender, 90, (res) => {
        if (res === 'granted') renderPermission(panel, { state: 'granted' }); else showManual();
      }),
    });
  } else showManual();
}

export function getGoal() { return repo.getGoal(); }
export function setGoal(g) { repo.setGoal(g); }
