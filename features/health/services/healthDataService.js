// Feeds normalised health records into Arete's existing stores, respecting
// the user's source preferences. Rules:
//   • one source per metric — never sum providers together
//   • never overwrite a manual answer silently (sleep goes through a
//     confirmation the user accepts or declines)
//   • imported workouts that duplicate Arete-logged ones are excluded
//     (Arete's own record wins)

import { healthRepository } from '../repositories/healthRepository.js';
import { resolveSource } from './healthSourcePreferences.js';
import { dedupeWorkouts, countable } from './healthDeduplication.js';

const pad2 = (n) => String(n).padStart(2, '0');
export function localDateOf(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
const todayLocal = () => localDateOf(new Date().toISOString());

function rj(key, fallback) { try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch { return fallback; } }
function wj(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }

/** Latest countable record per local date for a type from ONE provider. */
function dailyFrom(records, provider) {
  const byDate = {};
  for (const r of countable(records)) {
    if (r.sourceProvider !== provider) continue;
    const d = localDateOf(r.startTime);
    if (!byDate[d] || r.startTime > byDate[d].startTime) byDate[d] = r;
  }
  return byDate;
}

export function connectedProviderIds(repo) {
  const r = repo || healthRepository;
  const ids = [];
  for (const p of ['apple_health', 'health_connect', 'oura', 'whoop', 'fitbit', 'garmin', 'polar', 'withings', 'samsung_health']) {
    const c = r.getConnection(p);
    if (c && c.state === 'connected') ids.push(p);
  }
  // cloud providers managed on the Connections page (js/wearables.js) count too
  const wconn = rj('jarvis_connections', {});
  for (const p of ['oura', 'whoop', 'fitbit']) {
    if (wconn[p] && !ids.includes(p)) ids.push(p);
  }
  return ids;
}

/** STEPS → the step tracker's store (jarvis_steps), one source only. */
export function applySteps(repo) {
  const r = repo || healthRepository;
  const src = resolveSource('steps', connectedProviderIds(r), r);
  if (!src || src === 'arete') return 0;
  const daily = dailyFrom(r.getRecords('steps'), src);
  const map = rj('jarvis_steps', {});
  let n = 0;
  for (const date in daily) {
    const rec = daily[date];
    const existing = map[date];
    // phone-sensor / manual entries are kept unless this source is preferred —
    // preference already decided that, so imported value takes the slot, but
    // never silently: source is recorded on the row.
    if (existing && existing.source === 'manual' && date === todayLocal()) continue; // manual today stays
    map[date] = { date, steps: Math.round(rec.value || 0), goal: (existing && existing.goal) || 10000, source: src, lastSyncedAt: new Date().toISOString() };
    n++;
  }
  wj('jarvis_steps', map);
  return n;
}

/** WORKOUTS → workout history (jarvis_workouts) with Arete-wins dedup. */
export function applyWorkouts(repo) {
  const r = repo || healthRepository;
  const src = resolveSource('workouts', connectedProviderIds(r), r);
  if (!src || src === 'arete') return 0;
  const workouts = rj('jarvis_workouts', []);
  const records = r.getRecords('workout').filter((x) => x.sourceProvider === src);
  dedupeWorkouts(records, workouts, (id, dup) => r.markDuplicate(id, dup));
  let added = 0;
  for (const rec of countable(r.getRecords('workout')).filter((x) => x.sourceProvider === src)) {
    if (workouts.some((w) => w.sourceRecordId === rec.sourceRecordId && w.sourceProvider === rec.sourceProvider)) continue;
    const mins = Math.round(rec.value || (rec.endTime ? (Date.parse(rec.endTime) - Date.parse(rec.startTime)) / 60000 : 0));
    workouts.push({
      id: 'hlt-' + rec.sourceRecordId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40),
      name: String((rec.meta && rec.meta.activityType) || 'Workout') + (mins ? ` · ${mins} min` : ''),
      startedAt: Date.parse(rec.startTime),
      completedAt: rec.endTime ? Date.parse(rec.endTime) : Date.parse(rec.startTime),
      status: 'completed',
      imported: true,
      sourceProvider: rec.sourceProvider,
      sourceRecordId: rec.sourceRecordId,
      exercises: [],
      notes: 'Imported from ' + rec.sourceProvider.replace('_', ' '),
    });
    added++;
  }
  workouts.sort((a, b) => (a.completedAt || 0) - (b.completedAt || 0));
  wj('jarvis_workouts', workouts);
  return added;
}

/** RHR + HRV → optional readiness inputs via the existing wearables merge. */
export function applyRecovery(repo) {
  const r = repo || healthRepository;
  const src = resolveSource('recovery', connectedProviderIds(r), r);
  if (!src || src === 'arete') return false;
  const today = todayLocal();
  const rhr = dailyFrom(r.getRecords('resting_heart_rate'), src)[today];
  const hrv = dailyFrom(r.getRecords('hrv'), src)[today];
  if (!rhr && !hrv) return false;
  // js/wearables.js merges jarvis_conn_stats by its own PRIORITY into the
  // day score — feed the same cache under the matching source id.
  const wid = src === 'apple_health' ? 'apple' : src === 'health_connect' ? 'healthconnect' : src;
  const cache = rj('jarvis_conn_stats', {});
  cache[wid] = { ...(cache[wid] || {}), ...(rhr ? { rhr: Math.round(rhr.value) } : {}), ...(hrv ? { hrv: Math.round(hrv.value) } : {}), _at: Date.now() };
  wj('jarvis_conn_stats', cache);
  try { if (window.Wearables && window.Wearables.applyBestToData) window.Wearables.applyBestToData(); } catch {}
  return true;
}

/** WEIGHT + BODY FAT → progress store (jarvis_body_log). */
export function applyBody(repo) {
  const r = repo || healthRepository;
  const src = resolveSource('weight', connectedProviderIds(r), r);
  if (!src || src === 'arete') return 0;
  const log = rj('jarvis_body_log', []);
  const seen = new Set(log.map((e) => e.sourceRecordId));
  let n = 0;
  for (const rec of countable([...r.getRecords('weight'), ...r.getRecords('body_fat')])) {
    if (rec.sourceProvider !== src || seen.has(rec.sourceRecordId)) continue;
    log.push({
      date: localDateOf(rec.startTime),
      ...(rec.type === 'weight' ? { weightKg: Math.round((rec.value || 0) * 10) / 10 } : { bodyFatPct: Math.round((rec.value || 0) * 10) / 10 }),
      source: src, sourceRecordId: rec.sourceRecordId,
    });
    n++;
  }
  log.sort((a, b) => (a.date < b.date ? -1 : 1));
  wj('jarvis_body_log', log.slice(-400));
  return n;
}

/** ACTIVE CALORIES → daily activity summary (jarvis_activity_summary). */
export function applyActiveCalories(repo) {
  const r = repo || healthRepository;
  const src = resolveSource('active_calories', connectedProviderIds(r), r);
  if (!src || src === 'arete') return 0;
  const daily = dailyFrom(r.getRecords('active_calories'), src);
  const map = rj('jarvis_activity_summary', {});
  let n = 0;
  for (const date in daily) { map[date] = { activeKcal: Math.round(daily[date].value || 0), source: src }; n++; }
  wj('jarvis_activity_summary', map);
  return n;
}

// ── SLEEP — never applied silently. A suggestion is queued and the UI asks
//    “Use this value?” before anything is written. ─────────────────────────
const K_SLEEP_SUGGEST = 'jarvis_health_sleep_suggest';

export function queueSleepSuggestion(repo) {
  const r = repo || healthRepository;
  const src = resolveSource('sleep', connectedProviderIds(r), r);
  if (!src || src === 'arete') return null;
  const today = todayLocal();
  // last night's session: latest sleep record ending today
  const sessions = countable(r.getRecords('sleep')).filter(
    (x) => x.sourceProvider === src && localDateOf(x.endTime || x.startTime) === today
  );
  if (!sessions.length) return null;
  const total = sessions.reduce((a, s) => a + (s.value || 0), 0); // minutes
  if (total < 60) return null;
  const existing = rj(K_SLEEP_SUGGEST, null);
  if (existing && existing.date === today && existing.resolved) return null; // already answered
  const suggestion = { date: today, minutes: Math.round(total), provider: src, resolved: false };
  wj(K_SLEEP_SUGGEST, suggestion);
  return suggestion;
}
export function pendingSleepSuggestion() {
  const s = rj(K_SLEEP_SUGGEST, null);
  return s && !s.resolved && s.date === todayLocal() ? s : null;
}
export function resolveSleepSuggestion(useDetected) {
  const s = rj(K_SLEEP_SUGGEST, null);
  if (!s) return;
  if (useDetected) {
    // write into the sleep log the rest of the app reads
    const log = rj('jarvis_sleep_log', []);
    const rec = log.find((x) => x.date === s.date) || { date: s.date, quality: 7, wake: '07:00' };
    const wakeMin = (parseInt(rec.wake, 10) || 7) * 60 + (parseInt(String(rec.wake).split(':')[1], 10) || 0);
    const onsetMin = ((wakeMin - s.minutes) % 1440 + 1440) % 1440;
    rec.onset = `${pad2(Math.floor(onsetMin / 60))}:${pad2(onsetMin % 60)}`;
    rec.source = s.provider;
    const out = log.filter((x) => x.date !== s.date); out.push(rec);
    out.sort((a, b) => (a.date < b.date ? -1 : 1));
    wj('jarvis_sleep_log', out.slice(-60));
    // and into the wearables merge for the day score
    const wid = s.provider === 'apple_health' ? 'apple' : s.provider === 'health_connect' ? 'healthconnect' : s.provider;
    const cache = rj('jarvis_conn_stats', {});
    cache[wid] = { ...(cache[wid] || {}), sleepH: Math.round(s.minutes / 6) / 10, _at: Date.now() };
    wj('jarvis_conn_stats', cache);
    try { if (window.Wearables && window.Wearables.applyBestToData) window.Wearables.applyBestToData(); } catch {}
  }
  wj(K_SLEEP_SUGGEST, { ...s, resolved: true, used: !!useDetected });
}

/** Run all appliers after a sync. Returns a small summary for the UI. */
export function applyAll(repo) {
  return {
    steps: applySteps(repo),
    workouts: applyWorkouts(repo),
    recovery: applyRecovery(repo),
    body: applyBody(repo),
    activeCalories: applyActiveCalories(repo),
    sleepSuggestion: queueSleepSuggestion(repo),
  };
}
