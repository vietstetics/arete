// Chain mode: the camera stays on for every set of one exercise. Pure logic: no DOM, no storage.
//
// A set ends when the lifter stops: no rep for idleSec after at least one rep, or out of view for
// lostSec. Both are in seconds of the source clock, never frames, so they hold at any frame rate.
// They are starting points to tune in real use, not values fitted to anyone's videos.
import { setSpeed, READINESS } from './readiness.js';

export const CHAIN = { idleSec: 10, lostSec: 4, maxRestSec: 600 };

export function createSetEndDetector({ idleSec = CHAIN.idleSec, lostSec = CHAIN.lostSec } = {}) {
  let reps = 0, lastRepT = NaN, lostSince = NaN, fired = false;
  return {
    /** t in seconds; returns 'end' once per set. */
    push(t, { rep = false, visible = true } = {}) {
      if (!Number.isFinite(t) || fired) return null;
      if (rep) { reps++; lastRepT = t; }
      if (visible) lostSince = NaN; else if (!Number.isFinite(lostSince)) lostSince = t;
      if (!reps) return null;
      if (t - lastRepT >= idleSec || (Number.isFinite(lostSince) && t - lostSince >= lostSec)) { fired = true; return 'end'; }
      return null;
    },
    reset() { reps = 0; lastRepT = NaN; lostSince = NaN; fired = false; },
    get reps() { return reps; },
  };
}

const loadOf = (s) => {
  const v = s?.velocity?.loadKg;
  if (Number.isFinite(v)) return v;
  return s?.weight !== '' && s?.weight != null && Number.isFinite(+s.weight) ? +s.weight : NaN;
};
const sameLoad = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= Math.max(READINESS.minLoadKg, READINESS.loadTol * b);

/**
 * Set-to-set fatigue for one exercise's sets.
 * Returns { sets: [{ n, setId, loadKg, units, first, lossPct, counted }], drop: { pct, from, to, loadKg } | null, reason }.
 * A drop is only given between sets in m/s at the same load: relative speeds are each set's own rep 1.
 */
export function fatigueAcrossSets(sets) {
  const tracked = (sets || []).map((s, i) => ({ s, n: i + 1 })).filter(({ s }) => s?.velocity && Array.isArray(s.velocity.reps) && s.velocity.reps.length);
  const out = tracked.map(({ s, n }) => ({
    n, setId: s.id, loadKg: loadOf(s), units: s.velocity.units || 'relative',
    first: setSpeed(s.velocity), lossPct: Number.isFinite(s.velocity.lossPct) ? s.velocity.lossPct : null,
    counted: Number.isInteger(s.velocity.counted) ? s.velocity.counted : 0,
  }));
  if (out.length < 2) return { sets: out, drop: null, reason: 'Track 2 or more sets to compare them.' };
  const abs = out.filter((x) => x.units === 'm/s' && Number.isFinite(x.first));
  if (abs.length < 2) return { sets: out, drop: null, reason: 'Set-to-set speed needs m/s: add your height on the camera screen. Each set’s own speed loss is shown.' };
  const a = abs[0], b = abs.at(-1);
  if (!abs.every((x) => sameLoad(x.loadKg, a.loadKg))) return { sets: out, drop: null, reason: 'The weight changed between sets, so their speeds aren’t compared.' };
  return { sets: out, drop: { pct: 100 * (1 - b.first / a.first), from: a.n, to: b.n, loadKg: a.loadKg }, reason: null };
}
