// Personal models only. No universal velocity-to-RIR or MVT coefficients.
// See docs/velocity-prediction-methods.md for assumptions and readiness gates.
export const MODEL_VERSION = 'personal-v1';
const finite = Number.isFinite;
const positive = (x) => finite(x) && x > 0;
const textId = (x) => typeof x === 'string' && x.trim() ? x.trim() : null;
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const unique = (xs) => [...new Set(xs)];
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const unavailable = (reason, extra = {}) => ({ status: 'unavailable', estimate: null, range: null, reason, ...extra });
const endpointOf = (r) => r.rirEndpoint || r.failureEndpoint?.type || r.verifiedFailure?.endpoint?.replace('-failure', '').replace('-muscular', '') || 'unspecified';

/** Identity fields must be retained in every historical record. Context fills only the current record. */
export function predictionProfile(record = {}, context = {}) {
  return {
    userId: textId(record.userId ?? context.userId),
    exerciseId: textId(record.profileExerciseId ?? record.exerciseId ?? context.exerciseId),
    equipmentId: textId(record.equipmentId ?? record.equipmentKey ?? context.equipmentId ?? context.equipmentKey),
    source: textId(record.source ?? context.source), units: record.units ?? context.units,
    metric: textId(record.metric ?? context.metric), endpoint: context.endpoint ?? endpointOf(record),
  };
}
export function strengthProfileKey(profile) {
  if (!profile || !['userId', 'exerciseId', 'equipmentId', 'source', 'metric'].every((k) => textId(profile[k]))
      || !['m/s', 'relative'].includes(profile.units)) return null;
  return JSON.stringify(['userId', 'exerciseId', 'equipmentId', 'source', 'units', 'metric'].map((k) => profile[k]));
}
export function profileKey(profile) {
  const identity = strengthProfileKey(profile);
  return identity && ['technical', 'momentary'].includes(profile.endpoint) ? JSON.stringify([identity, profile.endpoint]) : null;
}
function accepted(record) {
  return record.synthetic !== true && record.quality?.accepted === true && !record.quality.cameraMoved
    && !record.quality.invalid && Array.isArray(record.reps) && textId(record.sessionId) && finite(record.at);
}
function physical(record) {
  const calibration = record.physicalCalibration ?? record.calibration;
  return record.units === 'm/s' && calibration?.validated === true
    && textId(calibration.version) && textId(calibration.method);
}
function velocity(record, rep) {
  if (rep?.result !== 'counted' || rep.velocity !== 'ok' || (record.units !== 'relative' && rep.estimate)) return NaN;
  return record.units === 'relative' ? (positive(rep.rel) ? rep.rel : NaN)
    : physical(record) && positive(rep.mcv) ? rep.mcv : NaN;
}
function featuresAt(record, index) {
  if (!accepted(record) || !positive(record.loadKg)) return null;
  const preceding = record.reps.slice(0, index + 1);
  // An unobserved/short rep changes both rep position and fatigue history.
  if (preceding.some((r) => r.result !== 'counted' || !positive(velocity(record, r)))) return null;
  const speeds = preceding.map((r) => velocity(record, r)), current = speeds.at(-1), best = Math.max(...speeds);
  if (!positive(current)) return null;
  return { loadKg: record.loadKg, velocity: current, loss: 1 - current / best, repPosition: preceding.length,
    ...(finite(record.restSec) && record.restSec >= 0 ? { restSec: record.restSec } : {}) };
}
function reportedRir(r) {
  const e = r.reportedEffort ?? r.reported;
  if (e) {
    if (e.enteredAs === 'rpe') return finite(e.rpe) && e.rpe >= 7 && e.rpe <= 10 ? { y: 10 - e.rpe, kind: 'reported-rpe-approximation' } : null;
    return finite(e.rir) && e.rir >= 0 && e.rir <= 10 ? { y: e.rir, kind: 'reported-rir' } : null;
  }
  const value = r.reportedRir ?? r.typedRir;
  return finite(value) && value >= 0 && value <= 10 ? { y: value, kind: 'reported-rir' } : null;
}
function verifiedFailure(r) {
  const f = r.failureEndpoint ?? r.verifiedFailure;
  return f?.verified === true && ['technical', 'momentary'].includes(endpointOf(r));
}

/** Failure labels count only valid completed reps before a documented endpoint; reports label only the final rep. */
export function buildRirLabels(records, { profile } = {}) {
  const key = profile ? profileKey(profile) : null, out = [], seen = new Set();
  for (const r of records) {
    const rk = profileKey(predictionProfile(r));
    if (!accepted(r) || !rk || (profile && key !== rk) || !textId(r.id) || seen.has(r.id)) continue;
    seen.add(r.id);
    const last = r.reps.length - 1, failure = verifiedFailure(r), report = reportedRir(r);
    if (!failure && !report) continue;
    // Unknown reps after/before the endpoint make backwards failure labels unknowable.
    if (r.reps.some((p) => p.result !== 'counted')) continue;
    if (failure && r.verifiedFailure?.repN != null && r.verifiedFailure.repN !== r.reps[last]?.n) continue;
    for (let i = failure ? 0 : last; i <= last; i++) {
      const features = featuresAt(r, i);
      if (features) out.push({ features, y: failure ? last - i : report.y,
        label: failure ? `verified-${endpointOf(r)}-failure` : report.kind, endpoint: endpointOf(r),
        setId: r.id, sessionId: r.sessionId, at: r.at,
        availableAt: Math.max(r.at, failure ? r.failureEndpoint?.at ?? r.verifiedFailure?.at ?? r.at : r.reportedEffort?.at ?? r.reported?.at ?? r.at), profileKey: rk });
    }
  }
  return out;
}

function solve(A, b) {
  const M = A.map((row, i) => [...row, b[i]]), n = b.length;
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let i = c + 1; i < n; i++) if (Math.abs(M[i][c]) > Math.abs(M[pivot][c])) pivot = i;
    if (!finite(M[pivot][c]) || Math.abs(M[pivot][c]) < 1e-12) return null;
    [M[c], M[pivot]] = [M[pivot], M[c]];
    const d = M[c][c]; for (let j = c; j <= n; j++) M[c][j] /= d;
    for (let i = 0; i < n; i++) if (i !== c) { const f = M[i][c]; for (let j = c; j <= n; j++) M[i][j] -= f * M[c][j]; }
  }
  const result = M.map((r) => r[n]);
  return result.every(finite) ? result : null;
}
function ridge(labels, { lambda = 1 } = {}) {
  if (!positive(lambda) || labels.length < 4 || unique(labels.map((l) => l.y)).length < 2) return null;
  let names = ['loadKg', 'velocity', 'loss', 'repPosition'];
  if (labels.every((l) => finite(l.features.restSec))) names.push('restSec');
  const stats = Object.fromEntries(names.map((k) => {
    const xs = labels.map((l) => l.features[k]), m = mean(xs), sd = Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
    return [k, { mean: m, sd, min: Math.min(...xs), max: Math.max(...xs) }];
  }));
  names = names.filter((k) => stats[k].sd > 1e-8);
  if (!names.some((k) => k === 'velocity' || k === 'loss') || labels.length < names.length + 2) return null;
  const setCounts = new Map(), sessionSets = new Map();
  for (const l of labels) {
    setCounts.set(l.setId, (setCounts.get(l.setId) || 0) + 1);
    if (!sessionSets.has(l.sessionId)) sessionSets.set(l.sessionId, new Set());
    sessionSets.get(l.sessionId).add(l.setId);
  }
  const size = names.length + 1, A = Array.from({ length: size }, () => Array(size).fill(0)), b = Array(size).fill(0);
  for (const l of labels) {
    const x = [1, ...names.map((k) => (l.features[k] - stats[k].mean) / stats[k].sd)];
    // Equal total influence per session, then per set; repetitions are correlated.
    const weight = 1 / (setCounts.get(l.setId) * sessionSets.get(l.sessionId).size);
    for (let i = 0; i < size; i++) { b[i] += weight * x[i] * l.y; for (let j = 0; j < size; j++) A[i][j] += weight * x[i] * x[j]; }
  }
  for (let i = 1; i < size; i++) A[i][i] += lambda;
  const beta = solve(A, b);
  if (!beta) return null;
  return { names, stats, beta, lambda, yMin: Math.min(...labels.map((l) => l.y)), yMax: Math.max(...labels.map((l) => l.y)),
    coefficients: { intercept: beta[0] - names.reduce((s, k, i) => s + beta[i + 1] * stats[k].mean / stats[k].sd, 0),
      ...Object.fromEntries(names.map((k, i) => [k, beta[i + 1] / stats[k].sd])) } };
}
function rawPredict(model, features) {
  if (!model || !features || model.names.some((k) => !finite(features[k]))) return NaN;
  return model.beta[0] + model.names.reduce((s, k, i) => s + model.beta[i + 1] * (features[k] - model.stats[k].mean) / model.stats[k].sd, 0);
}
function supported(model, features) {
  return Object.keys(model.stats).every((k) => finite(features[k]) && features[k] >= model.stats[k].min - 1e-9 && features[k] <= model.stats[k].max + 1e-9);
}
function groups(items) {
  const map = new Map();
  for (const i of items) { if (!map.has(i.sessionId)) map.set(i.sessionId, []); map.get(i.sessionId).push(i); }
  return [...map.values()].sort((a, b) => Math.min(...a.map((x) => x.at)) - Math.min(...b.map((x) => x.at)));
}
function errorSummary(tests) {
  if (!tests.length) return null;
  const errors = tests.flatMap((t) => t.errors), absolute = errors.map(Math.abs);
  return { sessions: tests.length, observations: errors.length, mae: mean(absolute), bias: mean(errors), withinOne: mean(absolute.map((x) => x <= 1 ? 1 : 0)),
    maxAbsoluteError: Math.max(...absolute), sessionMaxErrors: tests.map((t) => Math.max(...t.errors.map(Math.abs))),
    folds: tests.map((t) => ({ sessionId: t.sessionId, trainingSessions: t.trainingSessions })),
    interpretation: 'Chronological held-out session errors against reported/verified labels; no guaranteed coverage.' };
}

/** Fixed ridge penalty is an engineering regularizer, not a physiological constant. */
export function fitRirModel(records, { profile, lambda = 1, maxRirError = 2, minValidationSessions = 3, asOf = Infinity } = {}) {
  if (!profileKey(profile)) return unavailable('Specify the person, exercise/equipment variation, measurement convention and failure endpoint.');
  const labels = buildRirLabels(records, { profile }).filter((l) => l.availableAt < asOf), model = ridge(labels, { lambda });
  const tests = [];
  for (const test of groups(labels)) {
    const start = Math.min(...test.map((l) => l.at)), train = labels.filter((l) => l.sessionId !== test[0].sessionId && l.at < start && l.availableAt < start);
    // Exclude an entire overlapping session, not only its later repetitions.
    const trainSessions = groups(train).filter((g) => Math.max(...labels.filter((l) => l.sessionId === g[0].sessionId).map((l) => l.at)) < start).flat();
    const m = ridge(trainSessions, { lambda });
    if (!m) continue;
    const errors = test.filter((l) => supported(m, l.features)).map((l) => clamp(rawPredict(m, l.features), 0, m.yMax) - l.y);
    if (errors.length) tests.push({ sessionId: test[0].sessionId, trainingSessions: unique(trainSessions.map((l) => l.sessionId)), errors });
  }
  const validation = errorSummary(tests), info = { model, validation, labels: labels.length, sessions: unique(labels.map((l) => l.sessionId)).length,
    profile, method: 'Individual session-weighted ridge regression', modelVersion: MODEL_VERSION };
  if (!model) return unavailable('Insufficient variation in reliable labelled measurements to fit an individual relationship.', info);
  if (!validation || validation.sessions < minValidationSessions) return unavailable('Insufficient future-session validation to quantify personal prediction errors.', info);
  if (validation.maxAbsoluteError > maxRirError) return unavailable('Observed future-session RIR errors exceed the configured tolerance.', info);
  return { status: 'available', ...info };
}
export function predictRir(fitted, record) {
  if (fitted.status !== 'available') return unavailable(fitted.reason, { validation: fitted.validation ?? null, modelVersion: MODEL_VERSION });
  const features = Array.isArray(record.reps) ? featuresAt(record, record.reps.length - 1) : null;
  if (!features || !supported(fitted.model, features)) return unavailable('Current measurement quality or features fall outside the validated personal data.');
  if (profileKey(predictionProfile(record)) !== profileKey(fitted.profile)) return unavailable('Measurement profile differs from the personal model.');
  const estimate = clamp(rawPredict(fitted.model, features), 0, fitted.model.yMax);
  const error = Math.max(...fitted.validation.sessionMaxErrors);
  if (!finite(estimate) || !finite(error)) return unavailable('The personal model did not produce a finite result.');
  return { status: 'available', estimate, range: [Math.max(0, estimate - error), estimate + error],
    reason: 'Personal estimate; range uses the largest observed held-out session error, not a confidence interval.',
    method: fitted.method, modelVersion: MODEL_VERSION, validation: fitted.validation, coefficients: fitted.model.coefficients,
    labelCaution: 'Reported RIR is subjective; verified labels refer only to their recorded failure endpoint.' };
}
export function estimateRpe(rir) {
  if (rir?.status !== 'available' || !Array.isArray(rir.range) || rir.range.length !== 2 || !rir.range.every(finite)
      || !finite(rir.estimate) || rir.range[0] < 0 || rir.range[1] > 3 || rir.range[1] < rir.range[0] || rir.range[1] - rir.range[0] > 2) {
    return unavailable('RPE approximation requires a sufficiently narrow near-failure RIR range (0–3).');
  }
  return { status: 'available', estimate: 10 - rir.estimate, range: [10 - rir.range[1], 10 - rir.range[0]],
    reason: 'Approximate RIR-based RPE (10 − RIR); perceived exertion was not measured.', method: 'Near-failure RIR conversion', modelVersion: MODEL_VERSION };
}

function maximal(r) {
  const test = r.tested1RM ?? r.maximalAttempt;
  return test?.verified === true && positive(test.loadKg) && test.loadKg === r.loadKg && r.reps?.length === 1
    && positive(velocity(r, r.reps[0]));
}
function loadingPoints(records, profile, asOf) {
  const key = strengthProfileKey(profile), seen = new Set();
  if (!key) return [];
  return records.filter((r) => {
    if (!accepted(r) || !physical(r) || !textId(r.id) || seen.has(r.id) || strengthProfileKey(predictionProfile(r)) !== key
        || (r.maximalIntent !== true && !(maximal(r) && (r.tested1RM?.at ?? r.maximalAttempt?.at ?? r.at) < asOf))
        || !positive(r.loadKg) || !positive(velocity(r, r.reps[0]))) return false;
    seen.add(r.id); return true;
  }).map((r) => ({ velocity: velocity(r, r.reps[0]), loadKg: r.loadKg, sessionId: r.sessionId, at: r.at,
    verifiedAt: Math.max(r.at, r.tested1RM?.at ?? r.maximalAttempt?.at ?? r.at),
    maximal: maximal(r) && (r.tested1RM?.at ?? r.maximalAttempt?.at ?? r.at) < asOf, setId: r.id }));
}
/** Linear load = intercept + slope × mean concentric velocity; no default MVT. */
export function fitLoadVelocity(points) {
  const usable = points.filter((p) => positive(p.velocity) && positive(p.loadKg));
  if (usable.length < 3 || unique(usable.map((p) => p.loadKg)).length < 3) return unavailable('At least three distinct reliable loading points are needed to assess a load–velocity line.');
  // Average repeated observations at each session/load so repeated warmups do not dominate.
  const buckets = new Map();
  for (const p of usable) { const key = JSON.stringify([p.sessionId, p.loadKg]); if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(p); }
  const rows = [...buckets.values()].map((b) => ({ velocity: mean(b.map((p) => p.velocity)), loadKg: b[0].loadKg }));
  const x = mean(rows.map((p) => p.velocity)), y = mean(rows.map((p) => p.loadKg));
  const sxx = rows.reduce((s, p) => s + (p.velocity - x) ** 2, 0), syy = rows.reduce((s, p) => s + (p.loadKg - y) ** 2, 0);
  const slope = rows.reduce((s, p) => s + (p.velocity - x) * (p.loadKg - y), 0) / sxx, intercept = y - slope * x;
  if (!(slope < 0) || !finite(slope) || !finite(intercept)) return unavailable('The personal load–velocity relationship is degenerate or does not have a negative slope.');
  const sse = rows.reduce((s, p) => s + (p.loadKg - intercept - slope * p.velocity) ** 2, 0);
  return { status: 'available', intercept, slope, rSquared: syy > 0 ? 1 - sse / syy : null, points: usable,
    velocityRange: [Math.min(...rows.map((p) => p.velocity)), Math.max(...rows.map((p) => p.velocity))],
    loadRange: [Math.min(...rows.map((p) => p.loadKg)), Math.max(...rows.map((p) => p.loadKg))] };
}
export function predictOneRm(records, { profile, maxRelativeError = 0.1, minValidationSessions = 2, asOf = Infinity } = {}) {
  const points = loadingPoints(records.filter((r) => r.at < asOf), profile, asOf), fit = fitLoadVelocity(points), maxima = points.filter((p) => p.maximal);
  const info = { method: 'Individual load–MCV line at personally observed maximal velocity', modelVersion: MODEL_VERSION, fit, points };
  if (fit.status !== 'available') return unavailable(fit.reason, info);
  if (!maxima.length) return unavailable('No documented maximal single provides an individual minimal velocity threshold.', info);
  const tests = [];
  for (const session of groups(points)) {
    const at = Math.min(...session.map((p) => p.at));
    const train = groups(points).filter((g) => g[0].sessionId !== session[0].sessionId && Math.max(...g.map((p) => p.at)) < at).flat();
    const m = fitLoadVelocity(train), mvts = train.filter((p) => p.maximal && p.verifiedAt < at);
    if (m.status !== 'available' || !mvts.length) continue;
    const prediction = m.intercept + m.slope * mean(mvts.map((p) => p.velocity));
    const targets = session.filter((p) => p.maximal);
    if (targets.length && positive(prediction)) tests.push({ sessionId: session[0].sessionId,
      trainingSessions: unique(train.map((p) => p.sessionId)), errors: targets.map((p) => prediction - p.loadKg),
      relative: targets.map((p) => Math.abs(prediction - p.loadKg) / p.loadKg) });
  }
  const validation = errorSummary(tests), mvt = mean(maxima.map((p) => p.velocity));
  const estimate = fit.intercept + fit.slope * mvt, span = fit.velocityRange[1] - fit.velocityRange[0];
  const extrapolation = span > 0 ? Math.max(0, fit.velocityRange[0] - mvt, mvt - fit.velocityRange[1]) / span : Infinity;
  Object.assign(info, { mvt, validation, extrapolation, actualTested: maxima.map((p) => ({ at: p.at, loadKg: p.loadKg, velocity: p.velocity })) });
  if (!validation || validation.sessions < minValidationSessions) return unavailable('Insufficient subsequent maximal tests to quantify individual 1RM prediction error.', info);
  const relativeErrors = tests.flatMap((t) => t.relative);
  if (Math.max(...relativeErrors) > maxRelativeError || extrapolation > 0.25 || !positive(estimate)) return unavailable('Personal validation error or extrapolation exceeds the configured 1RM tolerance.', info);
  const error = Math.max(...validation.sessionMaxErrors);
  return { status: 'available', estimate, range: [Math.max(0, estimate - error), estimate + error],
    reason: 'Empirical range uses observed future-session maximal-test errors; not a guaranteed confidence interval.', ...info };
}

/** Optional conventional estimate; never blended with velocity 1RM. */
export function epleyEstimate({ loadKg, reps, rir, verifiedFailure: failure = false, exerciseSupported = false } = {}) {
  if (!exerciseSupported || !positive(loadKg) || !Number.isInteger(reps) || reps < 1) return unavailable('Epley requires a suitable exercise, known load and valid repetition count.');
  if (!failure && !(finite(rir) && rir >= 0)) return unavailable('A reported RIR or documented failure endpoint is needed; no effort is assumed.');
  const count = reps + (failure ? 0 : rir);
  if (count > 10 || count < 1) return unavailable('The optional Epley baseline is restricted to 1–10 estimated repetitions to failure.');
  const estimate = count === 1 ? loadKg : loadKg * (1 + count / 30);
  return { status: 'available', estimate, range: null, method: 'Epley (separate conventional estimate)', modelVersion: MODEL_VERSION,
    reason: 'No individual error range is available. Assumes the reported RIR and exercise suitability; not a velocity prediction.' };
}

/** No labels from the current set/session or future history enter its prediction. Pure and synchronous. */
export function predictionsForSet(record, historyRecords = [], context = {}) {
  const profile = predictionProfile(record, context), enriched = { ...record, ...profile, rirEndpoint: profile.endpoint };
  const key = profileKey(profile);
  const history = (Array.isArray(historyRecords) ? historyRecords : []).filter((r) => r && r.id !== record.id
    && r.sessionId !== record.sessionId && finite(r.at) && finite(record.at) && r.at < record.at && strengthProfileKey(predictionProfile(r)) === strengthProfileKey(profile));
  const fitted = fitRirModel(history, { profile, asOf: record.at }), rir = predictRir(fitted, enriched), rpe = estimateRpe(rir);
  const oneRm = strengthProfileKey(profile) ? predictOneRm(history, { profile, asOf: record.at }) : unavailable('A complete individual measurement profile is required.');
  const report = reportedRir(record);
  const incomplete = Array.isArray(record.reps) && record.reps.some((r) => r.result !== 'counted');
  const repetitionOneRm = incomplete ? unavailable('Short or unclear tracked attempts make the full-repetition failure count unsuitable for Epley.')
    : epleyEstimate({ loadKg: record.loadKg, reps: record.reps?.length ? record.reps.length : record.completedReps ?? record.counted,
      rir: report?.y, verifiedFailure: verifiedFailure(record), exerciseSupported: context.epleySupported === true });
  return { version: MODEL_VERSION, rir, rpe, oneRm, repetitionOneRm, velocity1RM: oneRm, repetition1RM: repetitionOneRm,
    profile: { ...profile, key, calibrationStatus: fitted.status, reason: fitted.reason || 'Personal model passed configured empirical gates.',
      labelledObservations: fitted.labels ?? 0, sessions: fitted.sessions ?? 0, validation: fitted.validation ?? null,
      loadVelocity: oneRm.fit ?? null, coefficients: fitted.model?.coefficients ?? null } };
}
export const predictSet = (history, record, { profile = {} } = {}) => predictionsForSet(record, history, profile);
