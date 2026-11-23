// What to lift next time: double progression over the plan's rep range. Pure logic: no DOM, no storage.
//
// The rule, stated to the lifter in the app (and in the guides it comes from):
//   · every working set last time reached the TOP of the rep range, at the planned effort or easier
//     (reps in reserve at or above the target)  → add the smallest weight step, back to the BOTTOM of the range;
//   · otherwise → the same weight, one more rep on each set that was below the top;
//   · below the BOTTOM of the range two sessions running at the same weight → about 5% lighter.
// Today's bar speed can hold back an increase: a first set that moved clearly slower than usual at that
// weight (readiness 'low') turns "add" into "hold".
// Sessions come from the same exercise on the same machine (and gym), so a different machine's numbers
// never set the targets. Nothing is suggested without a rep range or without a previous session.

/** "6–10", "8-12", "10" → { min, max } (null for "60s", "AMRAP" or nothing). */
export function parseRepRange(text) {
  const s = String(text ?? '').trim();
  let m = s.match(/^(\d+)\s*(?:[–—-]|to)\s*(\d+)$/i);
  if (m) { const a = +m[1], b = +m[2]; return a > 0 && b >= a ? { min: a, max: b } : null; }
  m = s.match(/^(\d+)$/);
  return m && +m[1] > 0 ? { min: +m[1], max: +m[1] } : null;
}

/** What the exercise is loaded with, from its machine and name (decides the weight step). */
export function equipmentOf({ name = '', machine = null } = {}) {
  const n = String(name).toLowerCase();
  if (/\bcable\b|pulldown|pull-down|face pull|pushdown|crossover/.test(n)) return 'cable';
  if (machine) return 'machine';
  if (/dumbbell|\bdb\b/.test(n)) return 'dumbbell';
  if (/smith/.test(n)) return 'barbell';
  if (/machine|leg press|hack squat|pendulum|pec deck|leg extension|leg curl|calf raise|hip (ab|ad)duction|lat pull/.test(n)) return 'machine';
  if (/barbell|bench press|squat|deadlift|overhead press|military press|\brow\b|hip thrust|good morning/.test(n)) return 'barbell';
  if (/pull-?up|chin-?up|dip\b|push-?up|plank/.test(n)) return 'bodyweight';
  return 'other';
}

/** The smallest sensible weight increase. A user's own step (a machine's stack) wins. */
export function loadStep({ equipment = 'other', unit = 'kg', custom = null } = {}) {
  if (Number.isFinite(custom) && custom > 0) return custom;
  const kg = { barbell: 2.5, dumbbell: 2, machine: 5, cable: 2.5, other: 2.5, bodyweight: 2.5 };
  const lb = { barbell: 5, dumbbell: 5, machine: 10, cable: 5, other: 5, bodyweight: 5 };
  return (unit === 'lb' ? lb : kg)[equipment] ?? (unit === 'lb' ? 5 : 2.5);
}

const num = (v) => (v === '' || v == null ? NaN : Number(v));
const round = (v, step) => Math.round(v / step) * step;

/** A session's working sets as numbers, those with reps only. */
function setsOf(session) {
  return (session?.sets || []).map((s) => ({ weight: num(s.weight), reps: num(s.reps), rir: num(s.rir) })).filter((s) => Number.isFinite(s.reps) && s.reps > 0);
}
/** The weight a session was done at: the heaviest set's (sets at other weights are back-off or warm-up-like). */
function workWeight(sets) { const w = sets.map((s) => s.weight).filter(Number.isFinite); return w.length ? Math.max(...w) : NaN; }

/**
 * sessions: newest first, each { sets: [{ weight, reps, rir }] } — completed working sets of this exercise
 *           on the same machine/gym, from earlier sessions.
 * opts: { range: {min,max} | text, targetRir, equipment, unit, step, readiness: 'low'|'below'|'normal'|'high'|null, setCount }
 * Returns null when nothing can be said, else
 *   { kind: 'add'|'reps'|'lighter'|'hold', weight, reps: [per working set], step, reason, basis: { weight, reps, rir } }
 */
export function suggestNext(sessions, opts = {}) {
  const range = typeof opts.range === 'object' && opts.range ? opts.range : parseRepRange(opts.range);
  if (!range) return null;
  const last = setsOf(sessions?.[0]);
  if (!last.length) return null;
  const unit = opts.unit === 'lb' ? 'lb' : 'kg';
  const equipment = opts.equipment || 'other';
  const step = loadStep({ equipment, unit, custom: opts.step });
  const atWeight = last.filter((s) => !Number.isFinite(workWeight(last)) || s.weight === workWeight(last));
  const w = workWeight(last);
  const n = Math.max(1, opts.setCount || atWeight.length);
  const targetRir = num(opts.targetRir);
  const basis = { weight: Number.isFinite(w) ? w : null, reps: atWeight.map((s) => s.reps), rir: atWeight.map((s) => s.rir).filter(Number.isFinite) };
  const repsList = (r) => Array.from({ length: n }, (_, i) => r[Math.min(i, r.length - 1)]);
  const loaded = Number.isFinite(w) && w > 0;

  // Below the bottom of the range two sessions running, at the same weight: lighter.
  const prev = setsOf(sessions?.[1]);
  const belowMin = (sets) => sets.some((s) => s.reps < range.min);
  if (loaded && belowMin(atWeight) && prev.length && workWeight(prev) === w && belowMin(prev.filter((s) => s.weight === w))) {
    const lighter = Math.max(step, round(w * 0.95, step) >= w ? w - step : round(w * 0.95, step));
    return { kind: 'lighter', weight: lighter, reps: repsList([range.min]), step, basis,
      reason: `Under ${range.min} reps two sessions running at ${w} ${unit} — about 5% lighter, back into the range.` };
  }

  const allTop = atWeight.length >= 1 && atWeight.every((s) => s.reps >= range.max);
  const effortOk = !Number.isFinite(targetRir) || !basis.rir.length || Math.min(...basis.rir) >= targetRir - 0.25;
  if (allTop && !loaded) {
    // Bodyweight with no load logged: more reps can't be suggested past the top; say so plainly.
    return { kind: 'hold', weight: null, reps: repsList([range.max]), step, basis,
      reason: `Top of the range (${range.max}) on every set — add weight (a belt or vest) or a harder variation.` };
  }
  if (allTop && effortOk) {
    if (opts.readiness === 'low') {
      return { kind: 'hold', weight: w, reps: repsList(basis.reps), step, basis,
        reason: `You earned an increase, but today’s bar speed is well below your usual — repeat ${w} ${unit} today.` };
    }
    return { kind: 'add', weight: +(w + step).toFixed(2), reps: repsList([range.min]), step, basis,
      reason: `Top of the range (${range.max}) on every set${Number.isFinite(targetRir) && basis.rir.length ? ` at ${Math.min(...basis.rir)} RIR or more` : ''} — add ${step} ${unit}, back to ${range.min} reps.` };
  }
  if (allTop && !effortOk) {
    return { kind: 'hold', weight: w, reps: repsList(basis.reps), step, basis,
      reason: `Top of the range, but harder than planned (${Math.min(...basis.rir)} RIR vs ${targetRir}) — same weight until it’s at ${targetRir} RIR.` };
  }
  const next = atWeight.map((s) => Math.min(range.max, Math.max(range.min, s.reps + (s.reps < range.max ? 1 : 0))));
  return { kind: 'reps', weight: loaded ? w : null, reps: repsList(next), step, basis,
    reason: `Same weight, one more rep on each set below ${range.max} (last time ${basis.reps.join(', ')}).` };
}
