// Versioned observations and derived measurements. Reports remain separate from model predictions.
// MCV uses each rep's own displacement/time; original-standard D/T is standardizedMcv.
// Native measurements never occupy fields with physical SI units.
export const RECORD_VERSION = 2;
export const MEASUREMENT_VERSION = 'own-concentric-v2';
export const SETS_KEY = 'arete_velocity_sets';
const finite = (v) => Number.isFinite(v);
const positive = (v) => finite(v) && v > 0;
const r3 = (v) => finite(v) ? Math.round(v * 1000) / 1000 : null;
const mean = (values) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const safe = (value) => {
  try { return value == null ? null : JSON.parse(JSON.stringify(value, (_, v) => typeof v === 'number' && !finite(v) ? null : v)); }
  catch { return null; }
};
const bounded = (v, lo, hi) => finite(v) && v >= lo && v <= hi ? v : null;
function reports(options, at) {
  const input = options.reportedEffort;
  return {
    rir: bounded(input && Object.hasOwn(input, 'rir') ? input.rir : options.typedRir, 0, 10),
    rpe: bounded(input?.rpe, 1, 10),
    enteredAs: input?.enteredAs === 'rpe' ? 'rpe' : 'rir',
    at: finite(input?.at) ? input.at : at,
  };
}
function finishRecord(rows, options, metadata) {
  const at = finite(options.at) ? options.at : Date.now();
  const reportedEffort = reports(options, at);
  const valid = rows.filter((r) => r.result === 'counted' && r.velocity === 'ok');
  const metric = (r) => metadata.scaled ? r.mcv : r.rel;
  const measured = valid.filter((r) => positive(metric(r)));
  const reference = measured.find((r) => r.isStandard);
  const values = measured.map(metric), latest = measured.at(-1), best = values.length ? Math.max(...values) : null;
  const lossPct = latest && measured.length >= 2 ? 100 * (1 - metric(latest) / best) : null;
  const quality = safe(metadata.quality) || {};
  quality.accepted = quality.accepted === true && !!reference && finite(metadata.fps) && metadata.fps >= 24
    && rows.length > 0 && rows.every((r) => r.result === 'counted' && r.velocity === 'ok');
  const peaks = valid.map((r) => r.peak).filter(positive);
  const result = {
    v: RECORD_VERSION, at, lift: options.lift ?? null, exercise: options.exercise ?? null,
    source: metadata.source, tracker: metadata.tracker, metric: 'mean-concentric-velocity',
    measurementVersion: MEASUREMENT_VERSION, calibrationVersion: metadata.calibration?.version ?? 'unverified-v1',
    predictionVersion: options.predictions?.version ?? null,
    loadKg: r3(options.loadKg), typedRir: reportedEffort.rir, reportedEffort,
    units: metadata.scaled ? 'm/s' : 'relative', nativeUnits: metadata.nativeUnits || 'native-units',
    fps: r3(metadata.fps), calibration: safe(metadata.calibration), quality,
    standard: safe(metadata.standard), D: metadata.scaled ? r3(metadata.D) : null,
    counted: rows.filter((r) => r.result === 'counted').length,
    short: rows.filter((r) => r.result === 'short').length,
    unclear: rows.filter((r) => r.result === 'unclear').length,
    rep1: reference ? r3(metric(reference)) : null, best: r3(best), last: latest ? r3(metric(latest)) : null,
    mean: r3(mean(values)), peak: metadata.scaled && peaks.length ? r3(Math.max(...peaks)) : null,
    meanPropulsive: metadata.scaled ? r3(mean(valid.map((r) => r.mpv).filter(positive))) : null,
    lossPct: r3(lossPct), bestLossPct: r3(lossPct),
    originalLossPct: reference && latest && measured.length >= 2 ? r3((1 - latest.rel) * 100) : null,
    standardLossPct: reference && latest && measured.length >= 2 && finite(latest.standardRel) ? r3((1 - latest.standardRel) * 100) : null,
    comparisonRep: latest?.n ?? null, fastestRep: measured.find((r) => metric(r) === best)?.n ?? null,
    failureEndpoint: safe(options.failureEndpoint), tested1RM: safe(options.tested1RM), predictions: safe(options.predictions),
    restSeconds: positive(options.restSeconds) ? r3(options.restSeconds) : null,
    massContext: safe(options.massContext ?? metadata.massContext),
    observations: safe(options.observations),
    derived: { version: MEASUREMENT_VERSION, metric: 'mean-concentric-velocity', meanConvention: 'own concentric displacement / duration',
      standardizedConvention: 'original standard displacement / concentric duration',
      velocityLossConvention: 'latest valid rep vs fastest valid rep in the entire set' },
    reps: rows,
  };
  result.derived.units = result.units;
  result.derived.summary = { counted: result.counted, mean: result.mean, peak: result.peak, mpv: result.meanPropulsive,
    lossPct: result.lossPct, originalLossPct: result.originalLossPct, standardLossPct: result.standardLossPct,
    comparisonRep: result.comparisonRep, fastestRep: result.fastestRep };
  for (const key of ['id', 'userId', 'exerciseId', 'equipmentKey', 'sessionId', 'sessionDate', 'maximalIntent']) if (options[key] != null) result[key] = options[key];
  if (metadata.view) result.view = safe(metadata.view);
  return result;
}
/** Offline set: lab-only measurementRows can never become workout reps. */
export function buildSetRecord(analysis, options = {}) {
  const scaled = analysis.scaled === true;
  const sourceRows = Array.isArray(analysis.rows) ? analysis.rows : [];
  const native = (r) => positive(r.nativeMcv) ? r.nativeMcv : positive(r.mcvOwn) ? r.mcvOwn : positive(r.mcv) ? r.mcv : null;
  const own = (r) => positive(r.mcvOwn) ? r.mcvOwn : positive(r.distance) && positive(r.T) ? r.distance / r.T : r.mcv;
  const original = sourceRows.find((r) => r.isStandard && r.result === 'counted' && r.velocity === 'ok');
  const ref = original ? (scaled ? own(original) : native(original)) : null;
  const rows = sourceRows.map((r, i) => {
    const eligible = r.result === 'counted' && r.velocity === 'ok';
    const value = eligible ? (scaled ? own(r) : native(r)) : null;
    const rel = eligible && positive(ref) && positive(value) ? value / ref : eligible && finite(r.rel) ? r.rel : null;
    return {
      n: r.n ?? i + 1, result: r.result, velocity: eligible ? 'ok' : r.result === 'counted' ? 'unclear' : 'none',
      isStandard: !!r.isStandard, T: eligible ? r3(r.T) : null, tStart: r3(r.tStart), tEnd: r3(r.tEnd),
      mcv: eligible && scaled ? r3(value) : null, mcvOwn: eligible && scaled ? r3(value) : null,
      standardizedMcv: eligible && scaled ? r3(r.mcv) : null,
      mpv: eligible && scaled ? r3(r.mpv) : null, peak: eligible && scaled ? r3(r.pv) : null,
      distance: eligible && scaled ? r3(r.distance) : null,
      nativeMcv: eligible && !scaled ? r3(value) : null,
      nativeStandardizedMcv: eligible && !scaled ? r3(r.nativeStandardizedMcv ?? r.mcv) : null,
      nativePeak: eligible && !scaled ? r3(r.nativePeak ?? r.pv) : null,
      nativeDistance: eligible && !scaled ? r3(r.nativeDistance ?? r.distance) : null,
      rel: r3(rel), loss: finite(rel) ? r3(1 - rel) : null, standardRel: eligible ? r3(r.rel) : null,
      rom: { start: r3(r.bottom ?? r.lockout), finish: r3(r.top ?? r.trough) },
      avgPower: eligible && scaled ? r3(r.avgPower) : null, peakPower: eligible && scaled ? r3(r.peakPower) : null,
      peakForce: eligible && scaled ? r3(r.peakForce) : null,
      why: r.why || r.velocityWhy || '', estimate: safe(r.estimate), badges: safe(r.badges),
    };
  });
  const frameQuality = typeof analysis.quality === 'number' ? analysis.quality : null;
  const accepted = rows.length > 0 && rows.every((r) => r.result === 'counted' && r.velocity === 'ok')
    && positive(analysis.fps) && analysis.fps >= 24 && frameQuality >= 0.9
    && (!analysis.setQuality || (analysis.setQuality.ok && analysis.setQuality.clear && !analysis.setQuality.slow))
    && !analysis.refused;
  return finishRecord(rows, options, {
    scaled, source: analysis.tracker?.source ?? 'unknown', tracker: analysis.tracker?.id ?? 'unknown',
    fps: analysis.fps, calibration: analysis.calibration, nativeUnits: analysis.nativeUnits,
    quality: { ...(typeof analysis.quality === 'object' ? analysis.quality : {}), accepted, frameCoverage: frameQuality, ...(analysis.setQuality ? { tracking: analysis.setQuality } : {}) },
    standard: analysis.standard, D: analysis.Dm, massContext: analysis.massContext,
    view: analysis.view ? { ...analysis.view, mmPerPx: analysis.view.scaled && finite(analysis.view.mPerPx) ? analysis.view.mPerPx * 1000 : null, diameterM: analysis.diameterM ?? null } : null,
  });
}
/** Live capture: seconds remain seconds; one explicit scale applies to all physical distances and speeds. */
export function buildLiveSetRecord(options = {}) {
  const { reps = [], standard = null, source = 'pose', scaled = false, velocityScale = 1 } = options;
  const scale = positive(velocityScale) ? velocityScale : 1;
  const duration = (v) => v?.T ?? v?.dur;
  const displacement = (v) => v?.dist ?? v?.range;
  const own = (v) => positive(displacement(v)) && positive(duration(v)) ? displacement(v) / duration(v) : null;
  const original = reps.find((r) => r.isStandard);
  const reference = original?.result === 'counted' && positive(own(original.vel)) ? original : null;
  const first = reference ? own(reference.vel) : null;
  const rows = reps.map((r, i) => {
    const v = reference && r.result === 'counted' && positive(own(r.vel)) ? r.vel : null;
    const value = v ? own(v) : null;
    const rel = v && reference ? value / first : null;
    const standardRel = v && positive(reference?.vel.mv) && positive(v.mv) ? v.mv / reference.vel.mv : null;
    return {
      n: r.n ?? i + 1, result: r.result, velocity: v ? 'ok' : r.result === 'counted' ? 'unclear' : 'none', isStandard: !!r.isStandard,
      T: v ? r3(duration(v)) : null, tStart: v ? r3(v.tStart ?? r.tStart ?? r.startT) : null, tEnd: v ? r3(v.tEnd ?? r.tEnd) : null,
      mcv: v && scaled ? r3(value * scale) : null, mcvOwn: v && scaled ? r3(value * scale) : null,
      standardizedMcv: v && scaled ? r3(v.mv * scale) : null,
      mpv: v && scaled ? r3(v.mpv * scale) : null, peak: v && scaled ? r3(v.pv * scale) : null,
      distance: v && scaled ? r3(displacement(v) * scale) : null,
      nativeMcv: v && !scaled ? r3(value) : null, nativeStandardizedMcv: v && !scaled ? r3(v.mv) : null,
      nativePeak: v && !scaled ? r3(v.pv) : null, nativeDistance: v && !scaled ? r3(displacement(v)) : null,
      rel: r3(rel), loss: finite(rel) ? r3(1 - rel) : null, standardRel: r3(standardRel),
      rom: { start: r3(r.bottom ?? r.lockout), finish: r3(r.top ?? r.trough) },
      avgPower: v && scaled ? r3(v.avgPower) : null, peakPower: v && scaled ? r3(v.peakPower) : null, peakForce: v && scaled ? r3(v.peakForce) : null,
      why: r.why || r.velocityWhy || (!v && r.result === 'counted' ? reference ? 'No complete concentric measurement' : 'Original reference measurement unavailable' : ''),
      estimate: safe(v?.estimate), badges: safe(v?.badges),
    };
  });
  const at = finite(options.at) ? options.at : Date.now();
  return finishRecord(rows, { ...options, at, id: options.id ?? `velocity-${at}-${Math.random().toString(36).slice(2, 10)}` }, {
    scaled, source, tracker: source === 'plate' ? 'plate3d-live' : 'pose-live', fps: options.fps,
    calibration: options.calibration, quality: options.quality, nativeUnits: options.nativeUnits,
    standard: standard ? { start: r3(standard.start), finish: r3(standard.finish), ...(finite(standard.tol) ? { tol: r3(standard.tol) } : {}), ...(finite(standard.sway) ? { sway: r3(standard.sway) } : {}) } : null,
    D: reference ? (reference.vel.D ?? displacement(reference.vel)) * scale : null,
  });
}
export function listSetRecords(storage) {
  try { const records = JSON.parse(storage.getItem(SETS_KEY) || '[]'); return Array.isArray(records) ? records : []; } catch { return []; }
}
export function saveSetRecord(storage, record, { keep = 500 } = {}) {
  const all = listSetRecords(storage);
  const existing = record.id ? all.findIndex((r) => r?.id === record.id) : -1;
  if (existing >= 0) all[existing] = record; else all.push(record);
  storage.setItem(SETS_KEY, JSON.stringify(all.slice(-keep)));
  return all.length;
}
