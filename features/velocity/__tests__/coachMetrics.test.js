import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLiveSetRecord, buildSetRecord, RECORD_VERSION } from '../services/record.js';
import { coachMetrics, renderCoachMetrics } from '../services/coachMetrics.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} vs ${b}`);
const rep = (n, D, T, extra = {}) => ({ n, isStandard: n === 1, result: 'counted', bottom: 170, top: 45,
  vel: { mv: 0.5 / T, D: 0.5, dist: D, T, pv: D / T * 1.5, mpv: D / T * 1.1, tStart: n * 3, tEnd: n * 3 + T, ...extra } });
const sample = (extra = {}) => buildLiveSetRecord({ reps: [rep(1, 0.5, 1), rep(2, 0.48, 0.6), rep(3, 0.45, 0.75)],
  source: 'plate', scaled: true, loadKg: 100, fps: 60, standard: { start: 170, finish: 45 }, at: 123,
  calibration: { version: 'measured-plate-v1', diameterM: 0.45, validated: false }, quality: { accepted: true }, ...extra });

test('live persistence distinguishes own MCV, standard D/T, MPV and peak with valid seconds and displacement', () => {
  const record = sample();
  assert.equal(record.v, RECORD_VERSION);
  assert.equal(record.metric, 'mean-concentric-velocity');
  assert.equal(record.reps[1].mcv, 0.8);
  assert.equal(record.reps[1].standardizedMcv, 0.833);
  assert.equal(record.reps[1].mpv, 0.88);
  assert.equal(record.reps[1].peak, 1.2);
  assert.equal(record.reps[1].distance, 0.48);
  assert.equal(record.reps[1].T, 0.6);
  assert.equal(record.reps[1].tStart, 6);
  assert.equal(record.reps[1].tEnd, 6.6);
  assert.equal(record.mean, 0.633);
  assert.equal(record.peak, 1.2);
  assert.equal(record.meanPropulsive, 0.697);
  assert.equal(record.lossPct, 25, 'latest .6 vs fastest .8 in whole valid set');
  assert.equal(record.comparisonRep, 3);
  assert.equal(record.fastestRep, 2);
  assert.equal(record.originalLossPct, -20, 'latest is faster than original .5');
  assert.equal(record.standardLossPct, -33.3, 'fixed-D/T baseline remains separate');
  assert.equal(record.quality.accepted, true);
  assert.equal(record.calibration.validated, false, 'tracking acceptance does not validate physical accuracy');
  assert.equal(record.measurementVersion, 'own-concentric-v2');
  assert.equal(record.calibrationVersion, 'measured-plate-v1');
  assert.deepEqual(JSON.parse(JSON.stringify(record)), record);
});

test('latest comparison uses only valid counted measurements; short, missing and unclear reps never become fastest', () => {
  const reps = [rep(1, 0.5, 1), { ...rep(2, 4, 0.1), result: 'short' }, rep(3, 0.4, 1),
    { ...rep(4, 6, 0.1), result: 'unclear' }, { n: 5, result: 'counted', vel: null }];
  const r = sample({ reps });
  const m = coachMetrics(r);
  assert.equal(r.lossPct, 20);
  assert.equal(r.comparisonRep, 3);
  assert.equal(r.fastestRep, 1);
  assert.equal(r.quality.accepted, false);
  assert.deepEqual(m.counts, { attempted: 5, counted: 3, short: 1, unclear: 1, measured: 2 });
  assert.equal(m.summary.fastest, 0.5);
  assert.equal(m.summary.last, 0.4);
  near(m.summary.lossPct, 20);
  assert.ok(m.rows.filter((x) => !x.available).every((x) => x.mcv === null && x.peak === null && x.distance === null));
});

test('native measurements stay out of SI fields and render relative speed against the original own MCV', () => {
  const r = sample({ scaled: false, velocityScale: 999, nativeUnits: 'radians' });
  assert.equal(r.D, null);
  assert.equal(r.rep1, 1);
  assert.equal(r.best, 1.6);
  assert.equal(r.last, 1.2);
  assert.equal(r.lossPct, 25);
  assert.equal(r.reps[1].nativeMcv, 0.8);
  assert.equal(r.reps[1].nativePeak, 1.2);
  assert.equal(r.reps[1].nativeDistance, 0.48);
  assert.ok(r.reps.every((x) => x.mcv === null && x.mpv === null && x.peak === null && x.distance === null));
  const m = coachMetrics(r), html = renderCoachMetrics(r);
  assert.equal(m.scaled, false);
  assert.equal(m.summary.fastest, 160);
  assert.equal(m.summary.last, 120);
  assert.equal(m.summary.peak, null);
  assert.equal(m.summary.nativePeak, 1.2);
  assert.match(html, /% of standard/);
  assert.match(html, /Native peak \(radians\/s\)/);
  assert.match(html, /Physical scale unavailable/);
  assert.match(html, /Mean propulsive velocity/);
});

test('model output and user reports remain separate and unavailable models never become zero predictions', () => {
  const r = sample({ typedRir: 4, reportedEffort: { rir: null, rpe: 8.5, enteredAs: 'rpe', at: 456 },
    predictions: { version: 'personal-v1', rir: { status: 'available', estimate: 2, range: [1, 3], reason: 'Personal held-out calibration' },
      rpe: { status: 'available', estimate: 8, range: [7, 9] },
      oneRm: { status: 'unavailable', estimate: null, reason: 'Physical velocity is not validated' } } });
  assert.deepEqual(r.reportedEffort, { rir: null, rpe: 8.5, enteredAs: 'rpe', at: 456 });
  assert.equal(r.typedRir, null, 'explicitly cleared report must not restore old typed RIR');
  assert.equal(r.predictionVersion, 'personal-v1');
  const m = coachMetrics(r), html = renderCoachMetrics(r);
  assert.equal(m.predictions.rir.estimate, 2);
  assert.equal(m.reportedEffort.rpe, 8.5);
  assert.equal(m.predictions.oneRm.status, 'unavailable');
  assert.equal(m.predictions.repetitionOneRm.status, 'unavailable');
  assert.match(html, /Range 1\.0–3\.0 RIR/);
  assert.match(html, /Physical velocity is not validated/);
  assert.match(html, /User-reported RPE/);
  assert.match(html, /Estimated RPE/);
  const none = coachMetrics(sample());
  assert.equal(none.predictions.rir.estimate, null);
  assert.equal(none.predictions.rir.status, 'unavailable');
});

test('renderer escapes external strings and suppresses unverified or multi-rep tested 1RM', () => {
  const attack = '<img src=x onerror=alert(1)>';
  const r = sample({ quality: { accepted: false, note: attack }, tested1RM: { verified: false, loadKg: 987 },
    failureEndpoint: { verified: true, type: attack }, predictions: { rir: { status: 'unavailable', reason: attack } } });
  const html = renderCoachMetrics(r);
  assert.ok(!html.includes('<img'));
  assert.match(html, /&lt;img/);
  assert.ok(!html.includes('987'));
  assert.equal(coachMetrics(sample({ tested1RM: { verified: true, loadKg: 987 } })).tested1RM, null);
  const single = sample({ loadKg: 987, reps: [rep(1, 0.5, 1)], tested1RM: { verified: true, loadKg: 987 } });
  assert.equal(coachMetrics(single).tested1RM.loadKg, 987);
  const manual = { loadKg: 110, completedReps: 1, reps: [], tested1RM: { verified: true, loadKg: 110 } };
  assert.equal(coachMetrics(manual).tested1RM.loadKg, 110);
  assert.equal(coachMetrics(manual).counts.counted, 1);
  assert.match(renderCoachMetrics(manual), /Manually logged reps/);
  assert.equal(coachMetrics({ ...manual, loadKg: 90 }).tested1RM, null, 'a different recorded load cannot be an actual maximal test');
});

test('absent derivatives and power remain explicitly unavailable without hiding known duration or ROM', () => {
  const r = sample({ reps: [rep(1, 0.5, 1, { mpv: NaN, pv: NaN })] });
  const m = coachMetrics(r), html = renderCoachMetrics(r);
  assert.equal(m.summary.duration, 1);
  assert.equal(m.summary.romConsistencyPct, 100);
  assert.equal(m.summary.mpv, null);
  assert.equal(m.summary.avgPower, null);
  assert.equal(m.summary.peakForce, null);
  assert.match(html, /Average power/);
  assert.match(html, /Peak power/);
  assert.match(html, /Peak force/);
  assert.match(html, /Unavailable/);
  assert.equal(m.summary.lossPct, null, 'one rep cannot describe a velocity loss trend');
});

test('offline records persist own and native conventions while retaining explicit quality and versions', () => {
  const r = buildSetRecord({ scaled: false, fps: 60, quality: 1, calibration: { kind: 'uncalibrated-pose', version: 'relative-v1' },
    nativeUnits: 'body-length-percent', tracker: { source: 'weight', id: 'pose-baseline' }, standard: { start: 100, finish: 40 }, rows: [
      { n: 1, result: 'counted', velocity: 'ok', isStandard: true, nativeMcv: 30, nativeStandardizedMcv: 30, nativeDistance: 30, nativePeak: 45, T: 1, rel: 1 },
      { n: 2, result: 'counted', velocity: 'ok', nativeMcv: 20, nativeStandardizedMcv: 25, nativeDistance: 24, nativePeak: 40, T: 1.2, rel: 0.8 },
    ] });
  assert.equal(r.reps[1].nativeMcv, 20);
  assert.equal(r.reps[1].standardRel, 0.8);
  assert.equal(r.reps[1].mcv, null);
  near(r.reps[1].rel, 0.667);
  assert.equal(r.calibrationVersion, 'relative-v1');
  assert.equal(r.quality.accepted, true);
  near(coachMetrics(r).summary.lossPct, 100 / 3);
});
