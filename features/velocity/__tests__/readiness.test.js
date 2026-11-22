import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setSpeed, speedReadiness } from '../services/readiness.js';

const DAY = 864e5, NOW = Date.UTC(2026, 10, 23, 9);
const rec = (mcvs, units = 'm/s') => ({ units, reps: mcvs.map((mcv, i) => ({ n: i + 1, result: 'counted', velocity: 'ok', mcv })) });
const past = (days, mcv, loadKg = 100, extra = {}) => ({ record: rec([mcv, mcv * 0.95]), loadKg, sessionId: 's' + days + (extra.tag || ''), at: NOW - days * DAY, ...extra });

test('set speed: fastest of the first three clean counted reps, m/s only', () => {
  assert.equal(setSpeed(rec([0.5, 0.62, 0.55, 0.9])), 0.62);
  assert.ok(Number.isNaN(setSpeed(rec([0.5], 'relative'))));
  assert.ok(Number.isNaN(setSpeed({ units: 'm/s', reps: [{ result: 'short', velocity: 'ok', mcv: 0.6 }] })));
});

test('slower than usual at the same weight says hold; much slower says lighter; faster says primed', () => {
  const history = [past(3, 0.60), past(7, 0.62), past(10, 0.58)]; // usual 0.60
  const at = (mcv) => speedReadiness({ record: rec([mcv]), loadKg: 100, sessionId: 'today', at: NOW }, history);
  assert.equal(at(0.60).level, 'normal');
  assert.equal(at(0.56).level, 'below');
  assert.equal(at(0.52).level, 'low');
  assert.equal(at(0.65).level, 'high');
  assert.equal(Math.round(at(0.54).diffPct), -10);
});

test('only the same weight, equipment, recent sessions, and one (the first) set per session count', () => {
  const history = [
    past(3, 0.60), past(5, 0.40, 140), past(6, 0.60, 100, { equipmentKey: 'other-machine' }), past(200, 0.30),
    { ...past(4, 0.61), sessionId: 's4' }, { ...past(4, 0.40), sessionId: 's4', at: NOW - 4 * DAY + 60e3 }, // later, tired set in the same session
  ];
  const r = speedReadiness({ record: rec([0.6]), loadKg: 101, equipmentKey: 'rack', sessionId: 'today', at: NOW }, history);
  assert.equal(r.status, 'ok');
  assert.equal(r.sessions, 2);
  assert.ok(Math.abs(r.usual - 0.605) < 1e-9);
});

test('not enough history, no weight or no m/s: no verdict, with the reason', () => {
  const t = { record: rec([0.6]), loadKg: 100, sessionId: 'today', at: NOW };
  assert.equal(speedReadiness(t, [past(3, 0.6)]).status, 'unavailable');
  assert.equal(speedReadiness({ ...t, loadKg: NaN }, [past(3, 0.6), past(5, 0.6)]).status, 'unavailable');
  assert.equal(speedReadiness({ ...t, record: rec([0.6], 'relative') }, [past(3, 0.6), past(5, 0.6)]).status, 'unavailable');
  // Today's own earlier sets never count as "usual".
  assert.equal(speedReadiness(t, [{ ...past(0, 0.6), sessionId: 'today', at: NOW - 60e3 }, past(3, 0.6)]).status, 'unavailable');
});
