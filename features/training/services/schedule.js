// Training-plan scheduling — pure functions, no DOM, no storage.
//
// Dates are LOCAL calendar dates as 'YYYY-MM-DD' keys. All arithmetic turns a
// key into a whole-day number through Date.UTC, so it never touches the
// device clock or timezone: daylight saving cannot add or drop a day, and
// month / year boundaries are just consecutive integers.
//
// A plan is versioned. Each edit stores a new version with an
// `effectiveFrom` date; the version in force on a date decides what was
// scheduled that day. Past weeks therefore keep the targets they had, and
// completed workouts (stored separately) are never rewritten.

const pad = (n) => String(n).padStart(2, '0');

/** Whole-day number for a 'YYYY-MM-DD' key (days since 1970-01-01). */
export function dayNum(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 864e5);
}

/** 'YYYY-MM-DD' key for a whole-day number. */
export function keyOf(n) {
  const dt = new Date(n * 864e5);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function addDays(key, n) { return keyOf(dayNum(key) + n); }
export function diffDays(from, to) { return dayNum(to) - dayNum(from); }

/** 0 = Sunday … 6 = Saturday. 1970-01-01 was a Thursday (4). */
export function weekday(key) { return (((dayNum(key) + 4) % 7) + 7) % 7; }

/** Sunday that starts the Sunday–Saturday week containing `key`. */
export function weekStart(key) { return addDays(key, -weekday(key)); }

/** Local 'YYYY-MM-DD' for a Date or unix-ms timestamp (default: now). */
export function localKey(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ── Splits ──────────────────────────────────────────────────────────────
// mode 'weekly' — workouts fill the chosen weekdays in order; the rotation
//                 either continues across weeks or restarts each week.
// mode 'eod'    — every second calendar day from a start date (FBEOD).
// mode 'custom' — the user assigns a routine to each training weekday.
// `variants`    — the user may add extra routines (A / B / C) that rotate.
export const SPLITS = [
  { id: 'ppl', name: 'Push / Pull / Legs', blurb: '3 or 6 days a week', mode: 'weekly', types: ['Push', 'Pull', 'Legs'], days: [1, 2, 3, 4, 5, 6] },
  { id: 'ul', name: 'Upper / Lower', blurb: '4 days a week', mode: 'weekly', types: ['Upper', 'Lower'], days: [1, 2, 4, 5] },
  { id: 'antpost', name: 'Anterior / Posterior', blurb: '4 days a week', mode: 'weekly', types: ['Anterior', 'Posterior'], days: [1, 2, 4, 5] },
  { id: 'fb', name: 'Full Body', blurb: '2–4 days a week', mode: 'weekly', types: ['Full Body'], days: [1, 3, 5], variants: true },
  { id: 'fbeod', name: 'Full Body Every Other Day', blurb: 'Every second day · 3–4 sessions a week', mode: 'eod', types: ['Full Body'], days: [], variants: true },
  { id: 'ulppl', name: 'Upper / Lower / Push / Pull / Legs', blurb: '5 days a week', mode: 'weekly', types: ['Upper', 'Lower', 'Push', 'Pull', 'Legs'], days: [1, 2, 3, 5, 6] },
  { id: 'ulfb', name: 'Upper / Lower / Full Body', blurb: '3 days a week', mode: 'weekly', types: ['Upper', 'Lower', 'Full Body'], days: [1, 3, 5] },
  { id: 'custom', name: 'Custom Split', blurb: 'Your own workouts, on your own days', mode: 'custom', types: [], days: [], variants: true },
];

export function splitById(id) { return SPLITS.find((s) => s.id === id) || null; }

/** Number of dates in [fromKey, toKey) whose weekday is in `days`. */
export function countTrainingDays(days, fromKey, toKey) {
  const n = diffDays(fromKey, toKey);
  if (n <= 0 || !days.length) return 0;
  let count = Math.floor(n / 7) * days.length;
  const startWd = weekday(fromKey);
  for (let i = 0; i < n % 7; i++) if (days.includes((startWd + i) % 7)) count++;
  return count;
}

/**
 * The session one plan version schedules on `key`, or null for a rest day.
 * Returns { routine, index } where index counts sessions from the anchor
 * (used to rotate routines A → B → C).
 */
export function sessionOn(plan, key) {
  if (!plan || !plan.routines || !plan.routines.length) return null;
  if (key < plan.startDate) return null;
  if (plan.endsOn && key >= plan.endsOn) return null;
  const routines = plan.routines;

  if (plan.mode === 'eod') {
    const diff = diffDays(plan.startDate, key);
    if (diff % 2 !== 0) return null;
    const index = diff / 2;
    return { routine: routines[index % routines.length], index };
  }

  const wd = weekday(key);
  if (plan.mode === 'custom') {
    const routine = routines.find((r) => r.id === (plan.assignments || {})[wd]);
    if (!routine) return null;
    return { routine, index: countTrainingDays(Object.keys(plan.assignments || {}).map(Number), plan.startDate, key) };
  }

  if (!(plan.days || []).includes(wd)) return null;
  const from = plan.rotation === 'reset' ? weekStart(key) : plan.startDate;
  const index = countTrainingDays(plan.days, from, key);
  return { routine: routines[index % routines.length], index };
}

// ── Versioned store ─────────────────────────────────────────────────────
// store = { versions: [plan, …] }, plan = {
//   id (version id), planId, splitId, name, mode, rotation, days,
//   assignments, startDate, effectiveFrom, endsOn, createdAt, routines:
//   [{ id, name, exercises: [{ id, name, sets, repMin, repMax, rir }] }] }

function latestOnOrBefore(store, key) {
  let best = null;
  for (const v of (store && store.versions) || []) {
    if (v.effectiveFrom > key) continue;
    if (!best || v.effectiveFrom > best.effectiveFrom || (v.effectiveFrom === best.effectiveFrom && (v.createdAt || 0) > (best.createdAt || 0))) best = v;
  }
  return best;
}

/** The plan version that decides `key`'s schedule, or null. */
export function planOn(store, key) {
  const v = latestOnOrBefore(store, key);
  if (!v) return null;
  if (v.endsOn && key >= v.endsOn) return null;
  return v;
}

/** The plan the user is on today (it may start on a later date). */
export function currentPlan(store, today) {
  const v = latestOnOrBefore(store, today);
  if (!v || (v.endsOn && today >= v.endsOn)) return null;
  return v;
}

/** What is scheduled on `key`: { date, plan, routine, index } or null. */
export function scheduledOn(store, key) {
  const plan = planOn(store, key);
  const s = sessionOn(plan, key);
  return s ? { date: key, plan, routine: s.routine, index: s.index } : null;
}

/** Every scheduled session from `fromKey` to `toKey`, inclusive. */
export function sessionsBetween(store, fromKey, toKey) {
  const out = [];
  const n = diffDays(fromKey, toKey);
  for (let i = 0; i <= n && i < 4000; i++) {
    const s = scheduledOn(store, addDays(fromKey, i));
    if (s) out.push(s);
  }
  return out;
}

/** The next `count` sessions on or after `fromKey` (searches ~4 months ahead). */
export function nextSessions(store, fromKey, count = 5, horizon = 120) {
  const out = [];
  for (let i = 0; i < horizon && out.length < count; i++) {
    const s = scheduledOn(store, addDays(fromKey, i));
    if (s) out.push(s);
  }
  return out;
}

/**
 * Seven entries (Sunday → Saturday) for the week starting `startKey`, using
 * one plan (not the store) — for previews of an unsaved plan.
 */
export function previewWeek(plan, startKey) {
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(startKey, i);
    const s = sessionOn(plan, date);
    return { date, weekday: weekday(date), routine: s ? s.routine : null };
  });
}

/** Planned sessions per week as a label, e.g. '4 sessions a week'. */
export function frequencyLabel(plan) {
  if (!plan) return '';
  if (plan.mode === 'eod') return 'Every other day · 3–4 a week';
  const n = plan.mode === 'custom' ? Object.keys(plan.assignments || {}).length : (plan.days || []).length;
  return `${n} session${n === 1 ? '' : 's'} a week`;
}

/** Target reps as text: '4–8', '10', or ''. */
export function repText(ex) {
  const a = ex.repMin, b = ex.repMax;
  if (a && b && a !== b) return `${a}–${b}`;
  return String(a || b || '');
}
