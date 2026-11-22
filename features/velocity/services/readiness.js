// Readiness from bar speed: how today's first tracked set of a lift compares with the speed you usually
// move the same weight at. Velocity-based training uses this as a daily readiness check (a load you
// know moving clearly slower than usual = under-recovered; faster = primed) — a measurement, unlike a
// questionnaire that hands back what you said. Pure logic: no DOM, no storage.
//
// Only camera sets in m/s are compared (relative speeds are each set's own rep 1 = 100%, so they can't
// be compared across sets), only with the same exercise (and equipment when both are known), the same
// weight (±2.5%, at least ±1 kg), from earlier sessions in the last 90 days. The usual speed is the
// median over at least 2 earlier sessions, one set each (each session's first set at that weight, the
// freshest, as today's is). Day-to-day noise in mean velocity is a few percent, so under 5% either way
// is "as usual".

export const READINESS = { loadTol: 0.025, minLoadKg: 1, windowDays: 90, minSessions: 2, notable: 0.05, marked: 0.1 };

/** A set's speed for readiness: the fastest of its first three counted reps with a clean speed (m/s), or NaN. */
export function setSpeed(record) {
  if (!record || record.units !== 'm/s' || !Array.isArray(record.reps)) return NaN;
  const v = record.reps.filter((r) => r && r.result === 'counted' && r.velocity === 'ok' && Number.isFinite(r.mcv) && r.mcv > 0).slice(0, 3).map((r) => r.mcv);
  return v.length ? Math.max(...v) : NaN;
}

const sameLoad = (a, b, o) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= Math.max(o.minLoadKg, o.loadTol * b);
const median = (xs) => { const s = xs.slice().sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/**
 * today:   { record, loadKg, equipmentKey?, sessionId, at }
 * history: [{ record, loadKg, equipmentKey?, sessionId, at }] — every earlier tracked set of the same exercise
 * Returns { status: 'ok', level, diffPct, usual, today, sessions, message } or { status: 'unavailable', reason }.
 *   level: 'low' (≥10% slower), 'below' (≥5% slower), 'normal', 'high' (≥5% faster)
 */
export function speedReadiness(today, history, opts = {}) {
  const o = { ...READINESS, ...opts };
  const now = Number.isFinite(today?.at) ? today.at : Date.now();
  const v = setSpeed(today?.record);
  if (!Number.isFinite(v)) return { status: 'unavailable', reason: 'No clean speed in m/s for this set (add your height on the camera screen).' };
  if (!Number.isFinite(today.loadKg)) return { status: 'unavailable', reason: 'Enter the weight to compare with your usual speed at it.' };
  const firstPerSession = new Map();
  for (const h of (history || []).slice().sort((a, b) => a.at - b.at)) {
    if (!h || h.sessionId === today.sessionId || !(h.at < now) || now - h.at > o.windowDays * 864e5) continue;
    if (today.equipmentKey && h.equipmentKey && h.equipmentKey !== today.equipmentKey) continue;
    if (!sameLoad(h.loadKg, today.loadKg, o)) continue;
    const s = setSpeed(h.record);
    if (Number.isFinite(s) && !firstPerSession.has(h.sessionId)) firstPerSession.set(h.sessionId, s);
  }
  const past = [...firstPerSession.values()];
  if (past.length < o.minSessions) return { status: 'unavailable', reason: `Your usual speed at ${today.loadKg} kg needs ${o.minSessions} earlier tracked sessions at this weight (${past.length} so far).` };
  const usual = median(past), diff = v / usual - 1;
  // Judged on the whole percent shown, so the words always match the number ("10% slower" is never "hold").
  const pct = Math.round(Math.abs(diff) * 100), slower = diff < 0;
  const level = slower && pct >= o.marked * 100 ? 'low' : slower && pct >= o.notable * 100 ? 'below' : !slower && pct >= o.notable * 100 ? 'high' : 'normal';
  const message = {
    low: `${pct}% slower than your usual at this weight — under-recovered today: keep the weight or go lighter.`,
    below: `${pct}% slower than your usual at this weight — hold the weight today.`,
    normal: 'Moving like usual at this weight — train as planned.',
    high: `${pct}% faster than your usual at this weight — you’re primed: a good day to push.`,
  }[level];
  return { status: 'ok', level, diffPct: diff * 100, usual, today: v, sessions: past.length, message };
}
