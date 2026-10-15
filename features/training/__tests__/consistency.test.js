import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayMap, weekSummary, recentWeeks, adherence, sessionStreak, daysSinceLast, slotDone } from '../services/consistency.js';

const R = (id, name = id) => ({ id, name, exercises: [] });
const at = (key, hour = 18) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d, hour, 0).getTime(); };
const set = (done = true) => ({ type: 'working', completed: done });
let n = 0;
const wk = (key, extra = {}) => ({ id: 'w-' + (++n), name: 'Session', completedAt: at(key), exercises: [{ sets: [set(), set(), set(false)] }], ...extra });

// Upper / Lower on Mon Tue Thu Fri from Monday 2026-06-15.
const UL = { versions: [{ id: 'v1', planId: 'p', mode: 'weekly', rotation: 'continue', days: [1, 2, 4, 5], startDate: '2026-06-15', effectiveFrom: '2026-06-15', createdAt: 1, routines: [R('u', 'Upper'), R('l', 'Lower')] }] };
// FBEOD from Sunday 2026-06-14.
const FBEOD = { versions: [{ id: 'v1', planId: 'p', mode: 'eod', startDate: '2026-06-14', effectiveFrom: '2026-06-14', createdAt: 1, routines: [R('fb', 'Full Body')] }] };

test('4 scheduled, 3 completed = 75%, rest days are not expected', () => {
  const workouts = [wk('2026-06-15', { scheduledFor: '2026-06-15' }), wk('2026-06-16', { scheduledFor: '2026-06-16' }), wk('2026-06-18', { scheduledFor: '2026-06-18' })];
  const w = weekSummary(UL, workouts, '2026-06-17', '2026-06-21');
  assert.equal(w.expected, 4);
  assert.equal(w.done, 3);
  assert.equal(w.pct, 0.75);
  assert.equal(w.finished, true); // Sunday 06-21 is past Saturday 06-20
  assert.equal(weekSummary(UL, workouts, '2026-06-17', '2026-06-20').finished, false);
});

test('the rate updates immediately: a mid-week session counts before the week ends', () => {
  const w = weekSummary(UL, [wk('2026-06-15', { scheduledFor: '2026-06-15' })], '2026-06-15', '2026-06-15');
  assert.deepEqual([w.done, w.expected, w.due], [1, 4, 1]);
});

test('FBEOD weekly targets change: 4/4, 2/3, 3/4', () => {
  const done = (keys) => keys.map((k) => wk(k, { scheduledFor: k }));
  const workouts = [
    ...done(['2026-06-14', '2026-06-16', '2026-06-18', '2026-06-20']), // week 1: Sun Tue Thu Sat
    ...done(['2026-06-22', '2026-06-26']),                             // week 2: Mon _ Fri
    ...done(['2026-06-28', '2026-06-30', '2026-07-04']),               // week 3: Sun Tue _ Sat
  ];
  const weeks = recentWeeks(FBEOD, workouts, '2026-07-05', 4).slice(0, 3);
  assert.deepEqual(weeks.map((w) => [w.done, w.expected]), [[4, 4], [2, 3], [3, 4]]);
  assert.equal(Math.round(weeks[1].pct * 1000) / 10, 66.7);
});

test('unfinished, planned and sample workouts never count', () => {
  const workouts = [
    { id: 'w-open', name: 'Opened', startedAt: at('2026-06-15'), exercises: [{ sets: [set()] }] }, // no completedAt
    { id: 'w-plan', name: 'Planned', plannedFor: '2026-06-16', exercises: [] },
    { id: 'mock-push-1', name: 'Push Day', completedAt: at('2026-06-18'), exercises: [] },
  ];
  assert.deepEqual(dayMap(workouts), {});
  assert.equal(weekSummary(UL, workouts, '2026-06-15', '2026-06-21').done, 0);
});

test('two sessions on one date: one calendar day, count 2, slot counted once', () => {
  const workouts = [wk('2026-06-15', { scheduledFor: '2026-06-15' }), wk('2026-06-15')];
  const map = dayMap(workouts);
  assert.equal(Object.keys(map).length, 1);
  assert.equal(map['2026-06-15'].count, 2);
  assert.equal(map['2026-06-15'].sets, 4); // completed working sets only
  assert.equal(weekSummary(UL, workouts, '2026-06-15', '2026-06-21').done, 1);
});

test('re-saving a session (same id) does not duplicate it', () => {
  const w = wk('2026-06-15', { scheduledFor: '2026-06-15' });
  assert.equal(dayMap([w, { ...w }])['2026-06-15'].count, 1);
});

test('an extra session on a rest day shows on the heatmap but not in the rate', () => {
  const workouts = [wk('2026-06-17')]; // Wednesday, a rest day
  assert.equal(dayMap(workouts)['2026-06-17'].count, 1);
  assert.equal(weekSummary(UL, workouts, '2026-06-17', '2026-06-21').done, 0);
});

test('a scheduled session done a day late still completes its own slot only', () => {
  const workouts = [wk('2026-06-16', { scheduledFor: '2026-06-15' })];
  assert.equal(slotDone(workouts, '2026-06-15'), true);
  assert.equal(slotDone(workouts, '2026-06-16'), false);
  assert.ok(dayMap(workouts)['2026-06-16']); // heatmap marks the day it happened
});

test('imported health workouts appear on the heatmap but do not tick plan slots', () => {
  const workouts = [{ id: 'hlt-1', name: 'Run', imported: true, completedAt: at('2026-06-15'), exercises: [] }];
  assert.equal(dayMap(workouts)['2026-06-15'].count, 1);
  assert.equal(slotDone(workouts, '2026-06-15'), false);
});

test('session streak: today pending does not break it, a miss does', () => {
  const done = (k) => wk(k, { scheduledFor: k });
  const workouts = [done('2026-06-15'), done('2026-06-16'), done('2026-06-18')];
  assert.equal(sessionStreak(UL, workouts, '2026-06-19'), 3); // Fri 06-19 scheduled, not done yet
  assert.equal(sessionStreak(UL, workouts, '2026-06-20'), 0); // Friday was missed
  assert.equal(sessionStreak(UL, [...workouts, done('2026-06-19')], '2026-06-21'), 4);
});

test('adherence uses finished weeks, or due-so-far for a brand-new plan', () => {
  const done = (k) => wk(k, { scheduledFor: k });
  const a = adherence(UL, [done('2026-06-15'), done('2026-06-16'), done('2026-06-18')], '2026-06-24');
  assert.deepEqual([a.done, a.expected, a.weeks], [3, 4, 1]);
  const fresh = adherence(UL, [done('2026-06-15')], '2026-06-16');
  assert.deepEqual([fresh.done, fresh.expected, fresh.weeks], [1, 2, 0]);
});

test('a plan edit mid-week keeps sessions already completed under the old version', () => {
  // FBEOD until Tue 06-16, then Upper/Lower on Mon/Wed/Fri from the same day.
  const store = { versions: [
    FBEOD.versions[0],
    { id: 'v2', planId: 'p', mode: 'weekly', rotation: 'continue', days: [1, 3, 5], startDate: '2026-06-14', effectiveFrom: '2026-06-16', createdAt: 2, routines: [R('u', 'Upper'), R('l', 'Lower')] },
  ] };
  const workouts = [wk('2026-06-14', { scheduledFor: '2026-06-14' }), wk('2026-06-16', { scheduledFor: '2026-06-16', name: 'Full Body' })];
  const w = weekSummary(store, workouts, '2026-06-16', '2026-06-16');
  // 06-14 (v1), 06-16 kept although v2 rests that day, then 06-17 Wed + 06-19 Fri under v2.
  assert.deepEqual(w.slots.map((s) => `${s.date.slice(5)}:${s.done ? 'done' : 'open'}`), ['06-14:done', '06-16:done', '06-17:open', '06-19:open']);
  assert.deepEqual([w.done, w.expected], [2, 4]);
});

test('daysSinceLast ignores sample data', () => {
  assert.equal(daysSinceLast([wk('2026-06-15'), { id: 'mock-x', completedAt: at('2026-06-20') }], '2026-06-21'), 6);
  assert.equal(daysSinceLast([], '2026-06-21'), null);
});
