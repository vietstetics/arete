import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyWeights, trendSeries, weeklyRate } from '../services/weightTrend.js';

const day = (n) => new Date(Date.UTC(2026, 10, 1) + n * 864e5).toISOString().slice(0, 10);

test('one weight per day: your own entry wins over an imported one; nonsense is dropped', () => {
  const d = dailyWeights(
    [{ date: day(1), kg: 80.2 }, { date: day(3), kg: 5 }],
    [{ date: day(1), weightKg: 81, source: 'apple_health' }, { date: day(2), weightKg: 80.6, source: 'apple_health' }, { date: day(2), bodyFatPct: 18 }],
  );
  assert.deepEqual(d.map((x) => [x.date, x.kg, x.source]), [[day(1), 80.2, 'you'], [day(2), 80.6, 'apple_health']]);
});

test('the trend moves 10% of the way to each daily weigh-in', () => {
  const s = trendSeries([{ date: day(0), kg: 80 }, { date: day(1), kg: 82 }, { date: day(2), kg: 80 }]);
  assert.equal(s[0].trend, 80);
  assert.ok(Math.abs(s[1].trend - 80.2) < 1e-9);
  assert.ok(Math.abs(s[2].trend - 80.18) < 1e-9);
});

test('a gap counts its days: after a week away the step is 1 − 0.9^7 (about 52%)', () => {
  const s = trendSeries([{ date: day(0), kg: 80 }, { date: day(7), kg: 78 }]);
  assert.ok(Math.abs(s[1].trend - (80 - 2 * (1 - 0.9 ** 7))) < 1e-9);
});

test('a steady loss of 0.5 kg/week reads close to 0.5 kg/week; daily noise does not swing it', () => {
  const noise = [0.6, -0.8, 0.3, -0.4, 0.9, -0.2, -0.7, 0.5, 0.1, -0.6, 0.8, -0.3, 0.2, -0.5, 0.4];
  const daily = Array.from({ length: 60 }, (_, i) => ({ date: day(i), kg: 85 - (0.5 / 7) * i + noise[i % noise.length] }));
  const r = weeklyRate(trendSeries(daily), 28);
  assert.ok(r && Math.abs(r.kgPerWeek + 0.5) < 0.12, `got ${r && r.kgPerWeek}`);
  assert.ok(r.pctPerWeek < 0);
});

test('no rate until there are 4 weigh-ins over at least a week', () => {
  assert.equal(weeklyRate(trendSeries([{ date: day(0), kg: 80 }, { date: day(1), kg: 80 }, { date: day(2), kg: 80 }])), null);
  assert.equal(weeklyRate(trendSeries([0, 1, 2, 3].map((i) => ({ date: day(i), kg: 80 })))), null);
});
