// Validation against a reference (Qwik VBT, Metric, a linear transducer…)
// — docs/velocity-tracking-plan.md, build step 1. Per set: line our reps up
// with the reference's, compute the error per rep and per metric, and keep
// a running accuracy table per lift. Target: ≤ 5% error on mean concentric
// velocity.

export const TARGET_PCT = 5;
export const REFERENCES = ['GymAware', 'Vitruve', 'Tendo', 'Linear transducer (other)', 'Qwik VBT', 'Metric', 'Other'];
/**
 * Transducer-level agreement on mean velocity, in m/s — what two good
 * devices manage against each other (GymAware vs 3D motion capture: standard
 * error 0.02–0.04 m/s, limits of agreement about ±0.03–0.06): average
 * difference within ±bias, root-mean-square difference within rms, and 95%
 * of differences within ±loa.
 */
export const TRANSDUCER = { bias: 0.03, rms: 0.04, loa: 0.06 };

/** Does an agreement() meet TRANSDUCER? { ok, bias, rms, loa } (each true / false; loa needs 2+ reps). */
export function transducerLevel(a) {
  const bias = Math.abs(a.bias) <= TRANSDUCER.bias, rms = a.rms <= TRANSDUCER.rms;
  const loa = a.n > 1 && a.loa[0] >= -TRANSDUCER.loa && a.loa[1] <= TRANSDUCER.loa;
  return { ok: a.n > 1 && bias && rms && loa, bias, rms, loa };
}

const num = (s) => {
  const v = parseFloat(String(s).replace(',', '.'));
  return Number.isFinite(v) ? v : NaN;
};

/**
 * Reference numbers per rep, from pasted text. Accepts:
 *  - one number per line (mean velocity, m/s);
 *  - several numbers per line: mean velocity, peak velocity, range of motion (cm), power (W);
 *  - a CSV with a header row: columns are found by name (mean / MCV / MV, peak, ROM / range /
 *    distance, power); a ROM column in metres (all values < 3) is converted to cm.
 * A leading rep number (1, 2, 3… matching the line) is ignored. Separators: tabs or semicolons
 * (then decimal commas like "0,62" work), otherwise commas, otherwise spaces.
 * Blank lines and lines without a number are skipped. Returns [{ mv, pv, romCm, power }].
 */
export function parseReference(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const split = (l) => (/[;\t]/.test(l) ? l.split(/[;\t]/) : l.includes(',') ? l.split(',') : l.split(/\s+/)).map((c) => c.trim()).filter((c) => c !== '');
  const head = split(lines[0]);
  const isHeader = head.some((c) => /[a-z]/i.test(c) && !Number.isFinite(num(c)));
  let cols = { mv: 0, pv: 1, romCm: 2, power: 3 }, body = lines;
  if (isHeader) {
    const find = (re) => head.findIndex((h) => re.test(h));
    cols = {
      mv: find(/(mean|avg|average)(?!.*propul).*vel|mcv|\bmv\b/i),
      pv: find(/peak.*vel|\bpv\b|max.*vel|peak(?!.*pow)/i),
      romCm: find(/\brom\b|range|displacement|distance/i),
      power: find(/power|watt/i),
    };
    if (cols.mv < 0) cols.mv = head.findIndex((h) => /vel/i.test(h) && !/peak|max|propul/i.test(h));
    body = lines.slice(1);
  }
  // "1  0.62  0.95": a rep number first — decided for the whole paste (1, 2, 3… on every line), never line by
  // line: a first rep whose mean velocity is exactly 1.00 is a speed, not a rep number.
  const cells = body.map((l) => split(l).map(num));
  const numbered = !isHeader && cells.length >= 2 && cells.every((c, i) => c.length >= 2 && c[0] === i + 1);
  const rows = cells.map((c0) => {
    const c = c0.slice();
    if (numbered) c.shift();
    const get = (i) => (i >= 0 && i < c.length ? c[i] : NaN);
    return { mv: get(cols.mv), pv: get(cols.pv), romCm: get(cols.romCm), power: get(cols.power) };
  }).filter((r) => Number.isFinite(r.mv));
  const roms = rows.map((r) => r.romCm).filter(Number.isFinite);
  if (roms.length && Math.max(...roms) < 3) rows.forEach((r) => { if (Number.isFinite(r.romCm)) r.romCm *= 100; });
  return rows;
}

/** Bias, spread, root-mean-square difference and limits of agreement of ours − reference, in absolute and % terms. */
export function agreement(pairs) {
  const ok = pairs.filter((p) => Number.isFinite(p.ours) && Number.isFinite(p.ref) && p.ref !== 0);
  const n = ok.length;
  if (!n) return { n: 0, bias: NaN, sd: NaN, rms: NaN, loa: [NaN, NaN], mae: NaN, mape: NaN, maxPct: NaN, biasPct: NaN };
  const d = ok.map((p) => p.ours - p.ref), pct = ok.map((p) => ((p.ours - p.ref) / p.ref) * 100);
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const bias = mean(d), sd = n > 1 ? Math.sqrt(d.reduce((s, x) => s + (x - bias) ** 2, 0) / (n - 1)) : 0;
  return {
    n, bias, sd, rms: Math.sqrt(mean(d.map((x) => x * x))), loa: [bias - 1.96 * sd, bias + 1.96 * sd],
    mae: mean(d.map(Math.abs)), mape: mean(pct.map(Math.abs)), maxPct: Math.max(...pct.map(Math.abs)), biasPct: mean(pct),
  };
}

/**
 * Line up our reps with the reference's, in order. Our short and unclear reps
 * still take their place (the reference counts every rep it saw), so the
 * order stays honest. Returns per-rep pairs and per-metric agreement.
 *   ours: [{ n, result, velocity, mcv, mcvOwn, loss, pv, romCm, avgPower }] (mcv in m/s when scaled)
 *   ref:  parseReference() rows
 *   scaled: whether our numbers are in real units (otherwise only velocity loss can be compared)
 */
export function compareSet(ours, ref, { scaled = true } = {}) {
  const n = Math.max(ours.length, ref.length);
  const refBest = ref.length ? ref[0].mv : NaN;
  const reps = [];
  for (let i = 0; i < n; i++) {
    const o = ours[i] || null, r = ref[i] || null;
    const refLoss = r && Number.isFinite(refBest) ? 1 - r.mv / refBest : NaN;
    reps.push({
      i: i + 1, ours: o, ref: r,
      mv: o && o.velocity === 'ok' && r && scaled ? { ours: o.mcv, ref: r.mv } : null,
      mvOwn: o && o.velocity === 'ok' && r && scaled && Number.isFinite(o.mcvOwn) ? { ours: o.mcvOwn, ref: r.mv } : null,
      loss: o && o.velocity === 'ok' && r ? { ours: o.loss, ref: refLoss } : null,
      pv: o && o.velocity === 'ok' && r && Number.isFinite(r.pv) && Number.isFinite(o.pv) && scaled ? { ours: o.pv, ref: r.pv } : null,
      rom: o && o.velocity === 'ok' && r && Number.isFinite(r.romCm) && Number.isFinite(o.romCm) ? { ours: o.romCm, ref: r.romCm } : null,
      power: o && o.velocity === 'ok' && r && Number.isFinite(r.power) && Number.isFinite(o.avgPower) ? { ours: o.avgPower, ref: r.power } : null,
    });
  }
  const pick = (k) => reps.map((x) => x[k]).filter(Boolean);
  // Velocity loss is compared in percentage points (both sides are already ratios).
  const lossPairs = pick('loss').filter((p) => Number.isFinite(p.ours) && Number.isFinite(p.ref));
  const lossDiff = lossPairs.map((p) => (p.ours - p.ref) * 100);
  return {
    reps,
    detected: ours.length, counted: ours.filter((o) => o.result === 'counted').length, refReps: ref.length,
    withVelocity: ours.filter((o) => o.velocity === 'ok').length,
    mv: agreement(pick('mv')), mvOwn: agreement(pick('mvOwn')), pv: agreement(pick('pv')), rom: agreement(pick('rom')), power: agreement(pick('power')),
    lossPts: lossDiff.length ? { n: lossDiff.length, mae: lossDiff.reduce((s, d) => s + Math.abs(d), 0) / lossDiff.length, max: Math.max(...lossDiff.map(Math.abs)) } : { n: 0, mae: NaN, max: NaN },
  };
}

/** Pass / fail against the plan's target (mean absolute error ≤ 5% on mean velocity). */
export const passes = (mvAgreement) => mvAgreement.n > 0 && mvAgreement.mape <= TARGET_PCT;

/**
 * Accuracy table across saved validation sessions: one row per lift and
 * tracker (the weight and the pose baseline are never mixed), plus one per
 * camera angle under it.
 * Sessions: [{ lift, tracker, angle, pairs: [{ ours, ref }], detected, refReps }].
 */
export function accuracyTable(sessions) {
  const groups = new Map();
  const add = (key, s, angle) => {
    if (!groups.has(key)) groups.set(key, { key, lift: s.lift, tracker: s.tracker || '', angle, sessions: 0, pairs: [], detected: 0, refReps: 0 });
    const g = groups.get(key);
    g.sessions++; g.pairs.push(...s.pairs); g.detected += s.detected || 0; g.refReps += s.refReps || 0;
  };
  for (const s of sessions) { add(`${s.lift}|${s.tracker}`, s, null); add(`${s.lift}|${s.tracker}|${s.angle ?? '—'}`, s, s.angle ?? '—'); }
  return [...groups.values()].map((g) => {
    const a = agreement(g.pairs);
    return { ...g, ...a, pass: passes(a), detection: g.refReps ? g.detected / g.refReps : NaN };
  }).sort((x, y) => x.lift.localeCompare(y.lift) || x.tracker.localeCompare(y.tracker) || (x.angle === null ? -1 : y.angle === null ? 1 : String(x.angle).localeCompare(String(y.angle))));
}

/** CSV of every compared rep across sessions (for coaches or a spreadsheet). */
export function toCsv(sessions) {
  const head = ['date', 'lift', 'reference', 'tracker', 'angle', 'distance_m', 'fps', 'rep', 'result', 'ours_mv', 'ref_mv', 'error_ms', 'error_pct', 'ours_loss_pct', 'ref_loss_pct', 'ours_pv', 'ref_pv', 'ours_rom_cm', 'ref_rom_cm'];
  const f = (v, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : '');
  const q = (s) => (/[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s ?? ''));
  const rows = [head.join(',')];
  for (const s of sessions) {
    for (const r of s.reps || []) {
      rows.push([new Date(s.at).toISOString(), s.lift, s.reference, s.tracker, s.angle ?? '', s.distance ?? '', f(s.fps, 1), r.i, r.result ?? '',
        f(r.oursMv), f(r.refMv), f(r.oursMv - r.refMv), f(((r.oursMv - r.refMv) / r.refMv) * 100, 1),
        f(r.oursLoss * 100, 1), f(r.refLoss * 100, 1), f(r.oursPv), f(r.refPv), f(r.oursRom, 1), f(r.refRom, 1)].map(q).join(','));
    }
  }
  return rows.join('\n');
}
