// Compact records shared by the validation lab and the workout logger.
// Physical units must be supplied explicitly by the measuring pipeline.

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
    ...(r.isStandard ? { isStandard: true } : {}),
    T: r3(r.T), mcv: analysis.scaled ? r3(r.mcv) : null,
    peak: analysis.scaled ? r3(r.pv) : null, distance: analysis.scaled ? r3(r.distance ?? r.D) : null,
    ...(!analysis.scaled && Number.isFinite(r.mcv) ? { nativeMcv: r3(r.mcv) } : {}),
    rel: r3(r.rel), loss: r3(r.loss),
    rom: { start: r3(r.bottom ?? r.lockout), finish: r3(r.top ?? r.trough) },
    ...(r.why || r.velocityWhy ? { why: r.why || r.velocityWhy } : {}), ...(r.estimate ? { estimate: r.estimate } : {}),
  }));
  const v = analysis.rows.filter((r) => r.result === 'counted' && r.velocity === 'ok');
  const metric = (r) => analysis.scaled ? r.mcv : r.rel;
  const measured = v.filter((r) => Number.isFinite(metric(r)) && metric(r) > 0);
  const mcvs = measured.map(metric);
  const reference = v.find((r) => r.isStandard && Number.isFinite(metric(r)) && metric(r) > 0);
  return {
    v: RECORD_VERSION, at, lift, exercise,
    source: analysis.tracker.source, tracker: analysis.tracker.id,
    loadKg: loadKg ?? null, typedRir: typedRir ?? null, fps: r3(analysis.fps),
    units: analysis.scaled ? 'm/s' : 'relative',
    calibration: analysis.calibration ?? null,
    D: analysis.scaled ? r3(analysis.Dm) : null,
    standard: analysis.standard ? { start: r3(analysis.standard.start), finish: r3(analysis.standard.finish) } : null,
    view: analysis.view ? { offAxisDeg: r3(analysis.view.offAxisDeg), mmPerPx: analysis.view.scaled ? r3(analysis.view.mPerPx * 1000) : null, diameterM: analysis.diameterM ?? null } : null,
    counted: analysis.rows.filter((r) => r.result === 'counted').length,
    rep1: reference ? r3(metric(reference)) : null,
    best: mcvs.length ? r3(Math.max(...mcvs)) : null,
    last: mcvs.length ? r3(mcvs[mcvs.length - 1]) : null,
    lossPct: reference && v.length >= 2 ? r3((1 - v[v.length - 1].rel) * 100) : null,
    reps,
  };
}

/** Saved set records (newest last). storage: anything with getItem / setItem. */
export function listSetRecords(storage) {
  try { const records = JSON.parse(storage.getItem(SETS_KEY) || '[]'); return Array.isArray(records) ? records : []; } catch { return []; }
}
export function saveSetRecord(storage, record, { keep = 500 } = {}) {
  const all = listSetRecords(storage);
  const existing = record.id ? all.findIndex((r) => r?.id === record.id) : -1;
  if (existing >= 0) all[existing] = record;
  else all.push(record);
  storage.setItem(SETS_KEY, JSON.stringify(all.slice(-keep)));
  return all.length;
}

/**
 * Convert the live rep counter's output to the same durable per-set format.
 * Only full counted reps receive velocities. Native position units stay
 * relative unless the caller explicitly supplies a physical calibration.
 * velocityScale converts native displacement/speed; time is always seconds.
 */
export function buildLiveSetRecord({ reps = [], standard = null, lift = null, exercise = null,
  loadKg = null, typedRir = null, source = 'pose', scaled = false, velocityScale = 1,
  fps = null, calibration = null, quality = null, at = Date.now(),
  id = `velocity-${at}-${Math.random().toString(36).slice(2, 10)}` } = {}) {
  const scale = Number.isFinite(velocityScale) && velocityScale > 0 ? velocityScale : 1;
  const eligible = reps.filter((r) => r.result === 'counted' && r.vel && Number.isFinite(r.vel.mv) && r.vel.mv > 0);
  const original = reps.find((r) => r.isStandard);
  const reference = original && eligible.includes(original) ? original : null;
  const valid = reference ? eligible : [];
  const first = reference?.vel.mv, best = valid.length ? Math.max(...valid.map((r) => r.vel.mv)) : null;
  const rows = reps.map((r, i) => {
    const v = valid.includes(r) ? r.vel : null;
    const why = r.why || r.velocityWhy || (!v && r.result === 'counted' ? reference ? 'No clear concentric velocity' : 'Reference rep velocity unavailable' : '');
    return { n: r.n ?? i + 1, result: r.result, velocity: v ? 'ok' : r.result === 'counted' ? 'unclear' : 'none',
      ...(r.isStandard ? { isStandard: true } : {}),
      T: v ? r3(v.T ?? v.dur) : null,
      mcv: v ? r3(v.mv * scale) : null, peak: v ? r3(v.pv * scale) : null,
      distance: v ? r3((v.dist ?? v.range) * scale) : null,
      rel: v && reference ? r3(v.mv / first) : null, loss: v && reference ? r3(1 - v.mv / first) : null,
      ...(why ? { why } : {}), ...(v?.estimate ? { estimate: v.estimate } : {}),
      rom: { start: r3(r.bottom ?? r.lockout), finish: r3(r.top ?? r.trough) },
    };
  });
  const last = valid[valid.length - 1]?.vel.mv;
  return {
    v: RECORD_VERSION, id, at, lift, exercise, source, tracker: source === 'plate' ? 'plate3d-live' : 'pose-live',
    loadKg: r3(loadKg), typedRir: r3(typedRir), fps: r3(fps), units: scaled ? 'm/s' : 'relative',
    calibration, quality,
    D: scaled && reference ? r3((reference.vel.dist ?? reference.vel.range) * scale) : null,
    standard: standard ? { start: r3(standard.start), finish: r3(standard.finish),
      ...(Number.isFinite(standard.tol) ? { tol: r3(standard.tol) } : {}),
      ...(Number.isFinite(standard.sway) ? { sway: r3(standard.sway) } : {}) } : null,
    counted: reps.filter((r) => r.result === 'counted').length,
    rep1: reference ? r3(first * scale) : null,
    best: valid.length ? r3(best * scale) : null,
    last: valid.length ? r3(last * scale) : null,
    lossPct: reference && valid.length >= 2 ? r3((1 - last / first) * 100) : null,
    bestLossPct: valid.length >= 2 ? r3((1 - last / best) * 100) : null,
    reps: rows,
  };
}
