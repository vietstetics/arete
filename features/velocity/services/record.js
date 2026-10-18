// Velocity per rep, stored per set — docs/velocity-tracking-plan.md, build
// step 2. One compact record per set with what the plan asks to keep:
// load, D, T per rep, mean concentric velocity per rep, velocity loss, the
// rep-1 standard, counted / short / unclear, and the typed RIR. Build step 3
// puts these records inside the workout record (so they flow through the
// Coaching tab's export and import); until then they're kept here.

export const RECORD_VERSION = 1;
export const SETS_KEY = 'arete_velocity_sets';

const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);

/**
 * Build a set record from an analyseSet() result.
 *   lift: 'squat' | 'bench' | 'curl'; exercise: library name; loadKg; typedRir (null if not typed)
 */
export function buildSetRecord(analysis, { lift, exercise, loadKg = null, typedRir = null, at = Date.now() } = {}) {
  const reps = analysis.rows.map((r) => ({
    n: r.n, result: r.result, velocity: r.velocity,
    T: r3(r.T), mcv: r3(r.mcv), rel: r3(r.rel), loss: r3(r.loss), ...(r.why ? { why: r.why } : {}),
  }));
  const v = analysis.rows.filter((r) => r.velocity === 'ok');
  const mcvs = v.map((r) => r.mcv);
  return {
    v: RECORD_VERSION, at, lift, exercise,
    source: analysis.tracker.source, tracker: analysis.tracker.id,
    loadKg: loadKg ?? null, typedRir: typedRir ?? null, fps: r3(analysis.fps),
    units: analysis.scaled ? 'm/s' : 'relative',
    D: analysis.scaled ? r3(analysis.Dm) : null,
    standard: analysis.standard ? { start: r3(analysis.standard.start), finish: r3(analysis.standard.finish) } : null,
    view: analysis.view ? { offAxisDeg: r3(analysis.view.offAxisDeg), mmPerPx: analysis.view.scaled ? r3(analysis.view.mPerPx * 1000) : null, diameterM: analysis.diameterM ?? null } : null,
    counted: analysis.rows.filter((r) => r.result === 'counted').length,
    rep1: mcvs.length ? r3(mcvs[0]) : null,
    best: mcvs.length ? r3(Math.max(...mcvs)) : null,
    last: mcvs.length ? r3(mcvs[mcvs.length - 1]) : null,
    lossPct: v.length ? r3((1 - v[v.length - 1].rel) * 100) : null,
    reps,
  };
}

/** Saved set records (newest last). storage: anything with getItem / setItem. */
export function listSetRecords(storage) {
  try { return JSON.parse(storage.getItem(SETS_KEY) || '[]'); } catch { return []; }
}
export function saveSetRecord(storage, record, { keep = 500 } = {}) {
  const all = listSetRecords(storage);
  all.push(record);
  storage.setItem(SETS_KEY, JSON.stringify(all.slice(-keep)));
  return all.length;
}
