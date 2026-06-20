import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sevenDayAverage, currentStreak, dashboardStats, historyStats } from '../services/stepStats.js';
import { addDays } from '../util/date.js';

const TODAY = '2026-06-20';
const GOAL = 10000;
const rec = (date, steps) => ({ date, steps, goal: GOAL, source: 'iphone', lastSyncedAt: '' });

test('sevenDayAverage averages last 7 days including missing-as-zero', () => {
  // Only today has 7000; other 6 days missing -> 7000/7 = 1000
  assert.equal(sevenDayAverage([rec(TODAY, 7000)], TODAY), 1000);
});

test('streak: today still in progress does not break a prior streak', () => {
  const recs = [
    rec(TODAY, 8000), // < goal, in progress
    rec(addDays(TODAY, -1), 11000),
    rec(addDays(TODAY, -2), 12000),
    rec(addDays(TODAY, -3), 5000), // breaks
  ];
  assert.equal(currentStreak(recs, GOAL, TODAY), 2);
});

test('streak: today met extends the streak', () => {
  const recs = [
    rec(TODAY, 10500),
    rec(addDays(TODAY, -1), 11000),
    rec(addDays(TODAY, -2), 12000),
    rec(addDays(TODAY, -3), 5000),
  ];
  assert.equal(currentStreak(recs, GOAL, TODAY), 3);
});

test('dashboardStats: percent + remaining', () => {
  const s = dashboardStats([rec(TODAY, 7420)], GOAL, TODAY);
  assert.equal(s.today, 7420);
  assert.equal(s.percent, 74);
  assert.equal(s.remaining, 2580);
});

test('historyStats: monthly total, best day, goal-completion days, 7-day series', () => {
  const recs = [
    rec(TODAY, 12000),
    rec(addDays(TODAY, -1), 9000),
    rec(addDays(TODAY, -2), 15000),
    rec('2026-05-31', 20000), // previous month — excluded from monthlyTotal, but all-time best
  ];
  const h = historyStats(recs, GOAL, TODAY);
  assert.equal(h.monthlyTotal, 12000 + 9000 + 15000); // June only
  assert.equal(h.bestDay.steps, 20000); // highest day = all-time personal record
  assert.equal(h.goalCompletionDays, 3); // 12k, 15k, 20k >= 10k
  assert.equal(h.series.length, 7);
  assert.equal(h.series[h.series.length - 1].date, TODAY);
  assert.equal(h.series[h.series.length - 1].metGoal, true);
});
