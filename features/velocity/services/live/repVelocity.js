// Shared workout semantics. A plate lift is a measurement; only a counted
// pose rep may use it, and rep 1's distance stays fixed for the whole set.
const positive = (v) => Number.isFinite(v) && v > 0;

export function standardizeMeasurements(reps, measurements) {
  const ref = reps.findIndex((r) => r.isStandard);
  const first = ref >= 0 && reps[ref].result === 'counted' ? measurements[ref] : null;
  const valid = (m) => m && m.ok !== false && positive(m.T) && positive(m.distance);
  const D = valid(first) ? first.distance : NaN;
  const rows = reps.map((rep, i) => {
    const lift = measurements[i];
    const row = { rep, lift, velocity: 'none', why: '', T: NaN, mcv: NaN, mcvOwn: NaN,
      pv: NaN, mpv: NaN, distance: NaN, rel: NaN, loss: NaN, tStart: NaN, tEnd: NaN };
    if (rep.result !== 'counted') return { ...row, why: `${rep.result} rep: no velocity` };
    if (!valid(lift)) return { ...row, velocity: 'unclear', why: lift?.why || 'No complete measured lift for this rep' };
    if (!positive(D)) return { ...row, velocity: 'unclear', why: 'The original standard has no complete measured lift' };
    const rel = first.T / lift.T;
    return { ...row, velocity: 'ok', T: lift.T, mcv: D / lift.T, mcvOwn: lift.distance / lift.T,
      pv: positive(lift.pv) ? lift.pv : NaN, mpv: positive(lift.mpv) ? lift.mpv : NaN,
      distance: lift.distance, rel, loss: 1 - rel, tStart: lift.tStart, tEnd: lift.tEnd };
  });
  return { D, rows };
}

export function standardizeLifts(reps, lifts, { maxPause = Infinity } = {}) {
  const used = new Set();
  const measurements = reps.map((rep, i) => {
    if (!Number.isFinite(rep.topT)) return null;
    // A lift belongs to the bottom it leaves. Never borrow the next rep's
    // lift to fill an occluded rep, or reuse one lift for two pose reps.
    const next = reps[i + 1]?.topT ?? Infinity;
    const index = lifts.findIndex((L, j) => !used.has(j)
      && Number.isFinite(L.tBottom) && L.tBottom >= rep.topT - 0.3
      && L.tBottom < next - 0.3
      && (L.ok ? L.tEnd : L.tTop) > rep.topT
      && (L.ok ? L.tStart : L.tBottom) - rep.topT < maxPause);
    if (index < 0) return null;
    used.add(index);
    return lifts[index];
  });
  return standardizeMeasurements(reps, measurements);
}
