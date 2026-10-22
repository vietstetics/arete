import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_VERSION, predictionProfile, profileKey, buildRirLabels, fitRirModel, predictRir,
  estimateRpe, fitLoadVelocity, predictOneRm, epleyEstimate, predictionsForSet } from '../services/predictions.js';

const clone = (x) => structuredClone(x);
function set(session, { loadKg = 80, count = 6, units = 'relative', id = `set-${session}`, failure = true } = {}) {
  const speeds = Array.from({ length: count }, (_, i) => 0.65 - 0.08 * i);
  return { id, at: session * 1000, sessionId: `session-${session}`, userId: 'athlete-1', exerciseId: 'back-squat',
    equipmentId: 'barbell-highbar', source: 'plate', metric: 'mean-concentric-velocity', units, loadKg,
    quality: { accepted: true, estimate: units === 'relative' }, calibration: { validated: true, method: 'reference-device', version: 'cal-1' },
    rirEndpoint: 'technical', ...(failure ? { failureEndpoint: { verified: true, type: 'technical', at: session * 1000 } } : {}),
    reps: speeds.map((v, i) => ({ n: i + 1, result: 'counted', velocity: 'ok', mcv: units === 'm/s' ? v : null,
      rel: v / speeds[0], ...(units === 'relative' ? { estimate: true } : {}), isStandard: i === 0 })) };
}
const history = () => Array.from({ length: 9 }, (_, i) => set(i + 1));

test('documented failure labels count valid repetitions backwards from the recorded endpoint', () => {
  const r = set(1), labels = buildRirLabels([r]);
  assert.deepEqual(labels.map((l) => l.y), [5, 4, 3, 2, 1, 0]);
  assert.ok(labels.every((l) => l.label === 'verified-technical-failure'));
  assert.equal(labels[0].features.velocity, 1);
  assert.equal(labels[0].features.loss, 0, 'a later faster rep cannot leak into an earlier feature');
  const noisy = clone(r); noisy.reps[2].result = 'unclear';
  assert.equal(buildRirLabels([noisy]).length, 0);
  const wrongEnd = clone(r); wrongEnd.verifiedFailure = { repN: 3 };
  assert.equal(buildRirLabels([wrongEnd]).length, 0);
});

test('reported RIR supplies only a subjective final-rep label; inferred RPE is never a label', () => {
  const r = set(1, { failure: false }); r.reportedEffort = { enteredAs: 'rir', rir: 2 };
  let labels = buildRirLabels([r]);
  assert.equal(labels.length, 1); assert.equal(labels[0].y, 2); assert.equal(labels[0].label, 'reported-rir');
  r.reportedEffort = { enteredAs: 'rpe', rpe: 8.5 };
  labels = buildRirLabels([r]); assert.equal(labels[0].y, 1.5); assert.match(labels[0].label, /approximation/);
  delete r.reportedEffort; r.predictions = { rir: { estimate: 2 }, rpe: { estimate: 8 } };
  assert.equal(buildRirLabels([r]).length, 0);
  r.reportedEffort = { enteredAs: 'rpe', rpe: 5 }; assert.equal(buildRirLabels([r]).length, 0);
  r.typedRir = 0; delete r.reportedEffort; assert.equal(buildRirLabels([r])[0].y, 0);
  r.reportedEffort = { rir: null, rpe: null, enteredAs: null };
  assert.equal(buildRirLabels([r]).length, 0, 'explicit empty report never resurrects an old scalar effort');
});

test('profile identity separates people, exact equipment, endpoint, measurement source and convention', () => {
  const r = set(1), profile = predictionProfile(r), key = profileKey(profile);
  assert.ok(key);
  for (const [field, value] of Object.entries({ userId: 'athlete-2', equipmentId: 'smith-machine', source: 'hand', metric: 'mean-propulsive-velocity', units: 'm/s', rirEndpoint: 'momentary' })) {
    const other = { ...r, [field]: value, id: `other-${field}` };
    assert.equal(buildRirLabels([other], { profile }).length, 0, field);
  }
  assert.equal(profileKey({ ...profile, equipmentId: null }), null);
  assert.equal(profileKey({ ...profile, endpoint: 'unspecified' }), null);
});

test('missing or rejected measurement quality and invalid units cannot train a model', () => {
  for (const transform of [
    (r) => { delete r.quality; }, (r) => { r.quality.accepted = false; }, (r) => { r.quality.cameraMoved = true; },
    (r) => { r.reps[0].rel = NaN; }, (r) => { r.units = 'pixels/s'; }, (r) => { r.loadKg = Infinity; },
    (r) => { r.sessionId = null; }, (r) => { r.at = NaN; }, (r) => { r.synthetic = true; },
  ]) { const r = set(1); transform(r); assert.equal(buildRirLabels([r]).length, 0); }
  const physical = set(1, { units: 'm/s' }); physical.calibration.validated = false;
  assert.equal(buildRirLabels([physical]).length, 0);
  const estimated = set(1, { units: 'm/s' }); estimated.reps.forEach((r) => { r.estimate = true; });
  assert.equal(buildRirLabels([estimated]).length, 0);
});

test('cold start and constant labels remain unavailable rather than receiving generic RIR constants', () => {
  const current = set(1, { failure: false });
  const result = predictionsForSet(current, []);
  assert.equal(result.rir.status, 'unavailable'); assert.equal(result.rir.estimate, null);
  assert.equal(result.oneRm.status, 'unavailable'); assert.equal(result.rpe.status, 'unavailable');
  const constant = history().map((r) => ({ ...r, failureEndpoint: null, typedRir: 2 }));
  assert.equal(fitRirModel(constant, { profile: predictionProfile(current) }).status, 'unavailable');
});

test('personal ridge model validates on future sessions and produces empirical uncertainty', () => {
  const records = history(), fitted = fitRirModel(records, { profile: predictionProfile(records[0]) });
  assert.equal(fitted.status, 'available', JSON.stringify(fitted));
  assert.ok(fitted.validation.sessions >= 3); assert.ok(fitted.validation.mae < 1);
  for (const fold of fitted.validation.folds) {
    assert.ok(!fold.trainingSessions.includes(fold.sessionId));
    const target = Number(fold.sessionId.split('-')[1]);
    assert.ok(fold.trainingSessions.every((s) => Number(s.split('-')[1]) < target));
  }
  const current = set(10, { failure: false }); current.reps = current.reps.slice(0, 4);
  const predicted = predictRir(fitted, current);
  assert.equal(predicted.status, 'available'); assert.ok(Math.abs(predicted.estimate - 2) < 0.5);
  assert.ok(predicted.range[0] <= predicted.estimate && predicted.range[1] >= predicted.estimate);
  assert.match(predicted.reason, /not a confidence interval/);
  assert.ok(Object.values(predicted.coefficients).every(Number.isFinite));
});

test('current labels, same-session sets and future records never influence current predictions', () => {
  const records = history(), current = set(10, { failure: false }); current.reps = current.reps.slice(0, 4);
  const baseline = predictionsForSet(current, records);
  const contaminated = [clone(current), { ...set(10), id: 'another-same-session', typedRir: 100 }, set(11)];
  const changed = clone(current); changed.typedRir = 10; changed.predictions = { rir: 9 };
  assert.deepEqual(predictionsForSet(changed, [...records, ...contaminated]).rir, baseline.rir);
  assert.equal(records[0].predictions, undefined, 'input histories remain observations');
});

test('out-of-distribution input and wrong profiles cannot receive a prediction', () => {
  const records = history(), model = fitRirModel(records, { profile: predictionProfile(records[0]) });
  const current = set(10); current.reps[0].rel = 4;
  assert.equal(predictRir(model, current).status, 'unavailable');
  const other = set(10); other.equipmentId = 'cable-stack';
  assert.equal(predictRir(model, other).status, 'unavailable');
  assert.equal(predictRir(model, { ...other, reps: undefined }).status, 'unavailable');
  const unseenLoad = set(10); unseenLoad.loadKg = 90;
  assert.equal(predictRir(model, unseenLoad).status, 'unavailable', 'constant training load is still a support boundary');
});

test('poor future-session errors keep the model unavailable even with many labels', () => {
  const records = history();
  for (let i = 0; i < records.length; i++) {
    records[i].failureEndpoint = null; records[i].typedRir = i % 2 ? 10 : 0;
    records[i].reps.at(-1).rel *= 1 + 0.1 * (i % 3);
  }
  const fit = fitRirModel(records, { profile: predictionProfile(records[0]) });
  assert.equal(fit.status, 'unavailable');
  assert.ok(fit.validation.maxAbsoluteError > 2);
});

test('RPE maps only a narrow, supported near-failure RIR range and preserves uncertainty', () => {
  const rpe = estimateRpe({ status: 'available', estimate: 2, range: [1.5, 2.5] });
  assert.equal(rpe.estimate, 8); assert.deepEqual(rpe.range, [7.5, 8.5]);
  assert.equal(estimateRpe({ status: 'available', estimate: 6, range: [5, 7] }).status, 'unavailable');
  assert.equal(estimateRpe({ status: 'available', estimate: 2, range: [0, 3] }).status, 'unavailable');
  assert.equal(estimateRpe({ status: 'unavailable', estimate: null }).status, 'unavailable');
});

function strengthHistory() {
  return Array.from({ length: 5 }, (_, i) => [60, 80, 100, 120].map((loadKg, j) => {
    const r = set(i + 1, { loadKg, count: 1, units: 'm/s', id: `strength-${i}-${j}`, failure: false });
    r.reps[0].mcv = (140 - loadKg) / 100; r.maximalIntent = true;
    if (loadKg === 120) r.tested1RM = { verified: true, loadKg: 120, at: r.at };
    return r;
  })).flat();
}
test('load–velocity regression recovers the known line; degenerate or positive slopes are rejected', () => {
  const fit = fitLoadVelocity([{ velocity: 0.8, loadKg: 60 }, { velocity: 0.6, loadKg: 80 }, { velocity: 0.4, loadKg: 100 }]);
  assert.equal(fit.status, 'available'); assert.ok(Math.abs(fit.intercept - 140) < 1e-9); assert.ok(Math.abs(fit.slope + 100) < 1e-9);
  assert.ok(Math.abs(fit.rSquared - 1) < 1e-9);
  assert.equal(fitLoadVelocity([{ velocity: 0.8, loadKg: 60 }, { velocity: 0.6, loadKg: 60 }]).status, 'unavailable');
  assert.equal(fitLoadVelocity([{ velocity: 0.4, loadKg: 60 }, { velocity: 0.6, loadKg: 80 }, { velocity: 0.8, loadKg: 100 }]).status, 'unavailable');
});
test('individual 1RM uses observed maximal-single velocity and separate future maximal tests', () => {
  const records = strengthHistory(), profile = predictionProfile(records[0]), predicted = predictOneRm(records, { profile });
  assert.equal(predicted.status, 'available', JSON.stringify(predicted));
  assert.ok(Math.abs(predicted.estimate - 120) < 1e-8); assert.ok(Math.abs(predicted.mvt - 0.2) < 1e-9);
  assert.ok(predicted.validation.sessions >= 2);
  for (const fold of predicted.validation.folds) assert.ok(!fold.trainingSessions.includes(fold.sessionId));
  assert.equal(predictOneRm(records.map((r) => ({ ...r, tested1RM: null })), { profile }).status, 'unavailable');
});
test('strength profiles do not require or mix in a RIR endpoint', () => {
  const records = strengthHistory(); records.forEach((r) => { delete r.rirEndpoint; });
  const current = { ...records[0], id: 'new', at: 9000, sessionId: 'new-session' };
  const result = predictionsForSet(current, records);
  assert.equal(result.rir.status, 'unavailable');
  assert.equal(result.oneRm.status, 'available', result.oneRm.reason);
  assert.ok(Math.abs(result.oneRm.estimate - 120) < 1e-8);
});
test('labels entered after prediction time and unverified future maxima cannot leak backwards', () => {
  const records = history(); records.forEach((r) => { r.failureEndpoint.at = 100000; });
  const fit = fitRirModel(records, { profile: predictionProfile(records[0]), asOf: 10000 });
  assert.equal(fit.status, 'unavailable'); assert.equal(fit.labels, 0);
  const strength = strengthHistory(); strength.forEach((r) => { if (r.tested1RM) r.tested1RM.at = 100000; });
  assert.equal(predictOneRm(strength, { profile: predictionProfile(strength[0]), asOf: 10000 }).status, 'unavailable');
});
test('relative units, uncalibrated geometry, missing maximal intent and unverified maxima never produce velocity 1RM', () => {
  for (const transform of [
    (r) => { r.units = 'relative'; }, (r) => { r.calibration.validated = false; },
    (r) => { r.maximalIntent = false; r.tested1RM = null; }, (r) => { if (r.tested1RM) r.tested1RM.verified = false; },
  ]) { const records = strengthHistory(); records.forEach(transform); assert.equal(predictOneRm(records, { profile: predictionProfile(records[0]) }).status, 'unavailable'); }
});
test('separate Epley baseline needs actual effort, suitable exercise and a limited rep range', () => {
  const estimate = epleyEstimate({ loadKg: 100, reps: 5, rir: 1, exerciseSupported: true });
  assert.equal(estimate.estimate, 120); assert.equal(estimate.range, null); assert.match(estimate.method, /separate/);
  assert.equal(epleyEstimate({ loadKg: 100, reps: 5, exerciseSupported: true }).status, 'unavailable');
  assert.equal(epleyEstimate({ loadKg: 100, reps: 12, rir: 0, exerciseSupported: true }).status, 'unavailable');
  assert.equal(epleyEstimate({ loadKg: 100, reps: 5, rir: 0 }).status, 'unavailable');
  assert.equal(epleyEstimate({ loadKg: 100, reps: 1, verifiedFailure: true, exerciseSupported: true }).estimate, 100);
});
test('manual logger counts permit separate repetition estimate without fabricating tracked reps', () => {
  const record = { id: 'manual', at: 1, loadKg: 100, completedReps: 5, reportedEffort: { enteredAs: 'rir', rir: 1 } };
  const before = clone(record), prediction = predictionsForSet(record, [], { epleySupported: true });
  assert.equal(prediction.version, MODEL_VERSION); assert.equal(prediction.repetitionOneRm.estimate, 120);
  assert.equal(prediction.rir.status, 'unavailable'); assert.equal(prediction.oneRm.status, 'unavailable');
  assert.deepEqual(record, before);
});
test('short or unclear tracked attempts block Epley rather than being silently removed from its count', () => {
  for (const result of ['short', 'unclear']) {
    const record = set(1); record.reps[2].result = result;
    record.reportedEffort = { enteredAs: 'rir', rir: 1 };
    const predictions = predictionsForSet(record, [], { epleySupported: true });
    assert.equal(predictions.repetitionOneRm.status, 'unavailable');
    assert.match(predictions.repetitionOneRm.reason, /Short or unclear/);
  }
});
