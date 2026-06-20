import { test } from 'node:test';
import assert from 'node:assert/strict';

// Reference for the reboot-safe per-day baseline algorithm implemented in
// native/android/StepCounterPlugin.kt (applyReading). TYPE_STEP_COUNTER counts
// since boot and RESETS TO 0 on reboot, so:
//   todaySteps = carry + (raw - baseline)
//   - new local day        -> baseline = raw, carry = 0
//   - reboot (raw < lastRaw) -> carry += (lastRaw - baseline); baseline = 0
function applyReading(state, raw, today) {
  let { day, baseline, carry, lastRaw } = state;
  if (day !== today || baseline < 0) { day = today; baseline = raw; carry = 0; }
  else if (lastRaw >= 0 && raw < lastRaw) { carry += lastRaw - baseline; baseline = 0; }
  const steps = Math.max(0, carry + (raw - baseline));
  return { state: { day, baseline, carry, lastRaw: raw }, steps };
}

test('normal accumulation within a day', () => {
  let s = { day: null, baseline: -1, carry: 0, lastRaw: -1 };
  let r;
  r = applyReading(s, 1000, 'D1'); s = r.state; assert.equal(r.steps, 0); // first reading = baseline
  r = applyReading(s, 1600, 'D1'); s = r.state; assert.equal(r.steps, 600);
  r = applyReading(s, 1800, 'D1'); s = r.state; assert.equal(r.steps, 800);
});

test('local midnight reset starts a fresh day at zero', () => {
  let s = { day: 'D1', baseline: 1000, carry: 0, lastRaw: 1800 };
  const r = applyReading(s, 1850, 'D2'); // new local day
  assert.equal(r.steps, 0);
  assert.equal(r.state.baseline, 1850);
});

test('phone reboot keeps counting today (counter reset to 0)', () => {
  let s = { day: null, baseline: -1, carry: 0, lastRaw: -1 };
  let r;
  r = applyReading(s, 1000, 'D1'); s = r.state; // baseline 1000
  r = applyReading(s, 1600, 'D1'); s = r.state; assert.equal(r.steps, 600);
  // reboot: counter restarts near 0
  r = applyReading(s, 50, 'D1'); s = r.state;
  assert.equal(r.steps, 650); // 600 banked + 50 since reboot
  r = applyReading(s, 200, 'D1'); s = r.state;
  assert.equal(r.steps, 800); // 600 + 200
});

test('reboot then new day resets cleanly', () => {
  let s = { day: 'D1', baseline: 0, carry: 600, lastRaw: 200 };
  const r = applyReading(s, 30, 'D2');
  assert.equal(r.steps, 0);
  assert.equal(r.state.carry, 0);
  assert.equal(r.state.baseline, 30);
});
