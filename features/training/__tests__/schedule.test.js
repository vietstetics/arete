import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, weekday, weekStart, countTrainingDays, sessionOn, planOn, currentPlan,
  scheduledOn, sessionsBetween, nextSessions, previewWeek, diffDays,
} from '../services/schedule.js';

const R = (id, name = id) => ({ id, name, exercises: [] });
const eod = (startDate, routines = [R('fb', 'Full Body')]) => ({ mode: 'eod', startDate, routines });
const weekly = (days, routines, startDate, rotation = 'continue') => ({ mode: 'weekly', days, routines, startDate, rotation });
const store = (...versions) => ({ versions });
const scheduledDays = (plan, from, n) => Array.from({ length: n }, (_, i) => addDays(from, i)).filter((d) => sessionOn(plan, d));

test('date helpers: known weekdays, week starts on Sunday', () => {
  assert.equal(weekday('2026-06-14'), 0); // Sunday
  assert.equal(weekday('2026-06-16'), 2); // Tuesday
  assert.equal(weekday('2026-10-13'), 2); // Tuesday
  assert.equal(weekday('1969-12-31'), 3); // before the epoch: Wednesday
  assert.equal(weekStart('2026-10-13'), '2026-10-11');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
});

test('countTrainingDays matches a brute-force count', () => {
  const days = [1, 3, 5, 6];
  for (let span = 0; span < 40; span++) {
    for (const from of ['2026-06-14', '2026-06-17', '2026-12-29']) {
      const to = addDays(from, span);
      let brute = 0;
      for (let i = 0; i < span; i++) if (days.includes(weekday(addDays(from, i)))) brute++;
      assert.equal(countTrainingDays(days, from, to), brute, `${from} +${span}`);
    }
  }
});

test('FBEOD: every second calendar day from any starting weekday', () => {
  for (let s = 0; s < 7; s++) {
    const start = addDays('2026-06-14', s);
    const days = scheduledDays(eod(start), addDays(start, -3), 70);
    assert.equal(days[0], start, 'first session is the start date');
    for (let i = 1; i < days.length; i++) assert.equal(diffDays(days[i - 1], days[i]), 2);
    assert.ok(!days.some((d) => d < start), 'nothing before the start date');
  }
});

test('FBEOD: alternates 4 and 3 sessions over Sunday–Saturday weeks and never resets', () => {
  const plan = eod('2026-06-14'); // a Sunday
  const weekdaysOf = (wk) => previewWeek(plan, addDays('2026-06-14', 7 * wk)).filter((d) => d.routine).map((d) => d.weekday);
  assert.deepEqual(weekdaysOf(0), [0, 2, 4, 6]); // Sun Tue Thu Sat
  assert.deepEqual(weekdaysOf(1), [1, 3, 5]);    // Mon Wed Fri
  assert.deepEqual(weekdaysOf(2), [0, 2, 4, 6]);
  for (let wk = 0; wk < 104; wk++) assert.equal(weekdaysOf(wk).length, wk % 2 ? 3 : 4, `week ${wk}`);
});

test('FBEOD: crosses months, years and leap days without drifting', () => {
  assert.deepEqual(scheduledDays(eod('2026-12-28'), '2026-12-28', 8), ['2026-12-28', '2026-12-30', '2027-01-01', '2027-01-03']);
  assert.deepEqual(scheduledDays(eod('2028-02-25'), '2028-02-25', 8), ['2028-02-25', '2028-02-27', '2028-02-29', '2028-03-02']);
  assert.deepEqual(scheduledDays(eod('2026-01-30'), '2026-01-30', 5), ['2026-01-30', '2026-02-01', '2026-02-03']);
  // Five years out the parity still holds exactly.
  const far = addDays('2026-06-14', 1826);
  assert.equal(!!sessionOn(eod('2026-06-14'), far), diffDays('2026-06-14', far) % 2 === 0);
});

test('FBEOD: daylight-saving changes cannot shift a session', () => {
  // US DST starts 2026-03-08, ends 2026-11-01; EU 2026-03-29 / 2026-10-25.
  assert.deepEqual(scheduledDays(eod('2026-03-06'), '2026-03-06', 7), ['2026-03-06', '2026-03-08', '2026-03-10', '2026-03-12']);
  assert.deepEqual(scheduledDays(eod('2026-10-24'), '2026-10-24', 10), ['2026-10-24', '2026-10-26', '2026-10-28', '2026-10-30', '2026-11-01']);
});

test('FBEOD: multiple routines rotate A → B → C → A', () => {
  const plan = eod('2026-06-14', [R('a', 'Full Body A'), R('b', 'Full Body B'), R('c', 'Full Body C')]);
  const names = scheduledDays(plan, '2026-06-14', 14).map((d) => sessionOn(plan, d).routine.name);
  assert.deepEqual(names, ['Full Body A', 'Full Body B', 'Full Body C', 'Full Body A', 'Full Body B', 'Full Body C', 'Full Body A']);
});

test('weekly: Upper / Lower on Mon Wed Fri Sun follows the example and continues', () => {
  const plan = weekly([0, 1, 3, 5], [R('u', 'Upper'), R('l', 'Lower')], '2026-06-15'); // Monday start
  const seq = scheduledDays(plan, '2026-06-15', 14).map((d) => `${weekday(d)}:${sessionOn(plan, d).routine.name}`);
  assert.deepEqual(seq, ['1:Upper', '3:Lower', '5:Upper', '0:Lower', '1:Upper', '3:Lower', '5:Upper', '0:Lower']);
});

test('weekly: odd day counts continue the rotation, or restart each week when asked', () => {
  const routines = [R('u', 'Upper'), R('l', 'Lower')];
  const names = (plan) => scheduledDays(plan, '2026-06-15', 14).map((d) => sessionOn(plan, d).routine.name);
  assert.deepEqual(names(weekly([1, 3, 5], routines, '2026-06-15', 'continue')), ['Upper', 'Lower', 'Upper', 'Lower', 'Upper', 'Lower']);
  assert.deepEqual(names(weekly([1, 3, 5], routines, '2026-06-15', 'reset')), ['Upper', 'Lower', 'Upper', 'Upper', 'Lower', 'Upper']);
});

test('weekly: rest days and days before the start date are empty', () => {
  const plan = weekly([1, 2, 4, 5], [R('u'), R('l')], '2026-06-17');
  assert.equal(sessionOn(plan, '2026-06-15'), null); // Monday before start
  assert.equal(sessionOn(plan, '2026-06-17'), null); // Wednesday rest
  assert.equal(sessionOn(plan, '2026-06-18').routine.id, 'u');
});

test('custom: each weekday runs its assigned routine', () => {
  const plan = { mode: 'custom', startDate: '2026-06-14', routines: [R('arms', 'Arms'), R('legs', 'Legs')], assignments: { 2: 'arms', 4: 'legs', 6: 'arms' } };
  const week = previewWeek(plan, '2026-06-14').map((d) => (d.routine ? d.routine.name : '-'));
  assert.deepEqual(week, ['-', '-', 'Arms', '-', 'Legs', '-', 'Arms']);
});

test('versions: edits apply from their effective date and leave the past alone', () => {
  const v1 = { ...weekly([1, 3, 5], [R('fb', 'Full Body')], '2026-06-01'), id: 'v1', planId: 'p', effectiveFrom: '2026-06-01', createdAt: 1 };
  const v2 = { ...weekly([2, 4], [R('fb', 'Full Body')], '2026-06-01'), id: 'v2', planId: 'p', effectiveFrom: '2026-06-15', createdAt: 2 };
  const s = store(v1, v2);
  assert.equal(planOn(s, '2026-06-10').id, 'v1');
  assert.ok(scheduledOn(s, '2026-06-10'));    // Wednesday under v1
  assert.equal(scheduledOn(s, '2026-06-17'), null); // Wednesday under v2
  assert.ok(scheduledOn(s, '2026-06-16'));    // Tuesday under v2
  assert.equal(planOn(s, '2026-05-31'), null);
});

test('versions: same-day tie goes to the newest, endsOn stops the schedule', () => {
  const a = { ...eod('2026-06-14'), id: 'a', effectiveFrom: '2026-06-14', createdAt: 1 };
  const b = { ...weekly([1], [R('x')], '2026-06-14'), id: 'b', effectiveFrom: '2026-06-14', createdAt: 2, endsOn: '2026-06-22' };
  const s = store(a, b);
  assert.equal(planOn(s, '2026-06-15').id, 'b');
  assert.equal(scheduledOn(s, '2026-06-22'), null);
  assert.equal(currentPlan(s, '2026-06-22'), null);
  assert.equal(currentPlan(s, '2026-06-20').id, 'b');
});

test('nextSessions and sessionsBetween walk the versioned store', () => {
  const s = store({ ...eod('2026-06-14'), id: 'v', effectiveFrom: '2026-06-14' });
  assert.deepEqual(nextSessions(s, '2026-06-15', 3).map((x) => x.date), ['2026-06-16', '2026-06-18', '2026-06-20']);
  assert.equal(sessionsBetween(s, '2026-06-14', '2026-06-20').length, 4);
});
