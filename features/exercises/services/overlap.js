// Exercise-selection overlap within one session. Pure functions.
//
// The comparison key is TARGET + ACTION + RESISTANCE PROFILE, evaluated
// together, then checked against angle / range-of-motion and setup details
// before a match is confirmed. The rules are documented in ../README.md;
// in short:
//   • Different target or action, or a different relevant profile → different.
//   • A meaningful setup or angle difference → different.
//   • Missing information needed to decide → possible overlap, never confirmed.
//   • Contributions whose required fields are unknown are not assessable and
//     stay out of the denominator.
//   • Overlap % per target = (N − U) / N, N = assessable selections,
//     U = distinct confirmed coverage groups. Sets never count.

import { targetSpec } from './catalogue.js';

const fmtProfile = (p) => (p === 'MID-RANGE' ? 'mid-range' : String(p).toLowerCase());

/** One contribution in canonical form (profile defaults to 'Not specified'). */
function norm(c) {
  return { target: c.target, action: c.action || null, profile: c.profile || 'Not specified', profileDetail: c.profileDetail || null, rom: c.rom || null, setup: c.setup || {} };
}

/** A stable signature so duplicate tags on one record count once. */
function signature(p, spec) {
  const setup = Object.keys(p.setup).sort().map((k) => [k, p.setup[k]]);
  return JSON.stringify([p.action, spec.profileMatters ? p.profile : null, p.rom ? [p.rom.joint, p.rom.start, p.rom.end] : null, setup]);
}

/** Why a part can't be assessed ([] when it can). */
export function partIssues(p, spec) {
  const out = [];
  if (!p.action) out.push('muscle action not recorded');
  if (spec.profileMatters) {
    if (p.profile === 'Not specified') out.push(p.profileDetail ? `resistance profile isn't a single curve for this selection (${p.profileDetail})` : 'resistance profile not specified');
    else if (p.profile === 'N/A') out.push('record says the profile is N/A, but the specification treats it as relevant for this target — needs review');
  }
  return out;
}

const range = (r) => [Math.min(r.start, r.end), Math.max(r.start, r.end)];

/**
 * Compare two parts that share a target.
 * → { status: 'same' | 'possible' | 'different', reasons: [] }
 */
export function compareParts(p, q, spec, label = (x) => x) {
  const diff = [], maybe = [];
  if (p.action !== q.action) diff.push(`different actions (${label(p.action)} vs ${label(q.action)})`);
  if (spec.profileMatters && p.profile !== q.profile) diff.push(`different resistance profiles (${fmtProfile(p.profile)} vs ${fmtProfile(q.profile)})`);
  if (p.rom && q.rom) {
    if (p.rom.joint !== q.rom.joint) maybe.push('angle ranges are recorded for different joints');
    else {
      const [a0, a1] = range(p.rom), [b0, b1] = range(q.rom);
      if (a0 === b0 && a1 === b1) { /* same range */ }
      else if (Math.min(a1, b1) <= Math.max(a0, b0)) diff.push(`angle ranges don't overlap (${p.rom.start}–${p.rom.end}° vs ${q.rom.start}–${q.rom.end}°)`);
      else maybe.push(`angle ranges partly overlap (${p.rom.start}–${p.rom.end}° vs ${q.rom.start}–${q.rom.end}°)`);
    }
  } else if (p.rom || q.rom) maybe.push('angle range recorded for only one of them');
  else if (spec.angleRange) maybe.push(`no angle data, and the specification gives ${spec.angleRange} for this target`);
  for (const k of new Set([...Object.keys(p.setup), ...Object.keys(q.setup)])) {
    const a = p.setup[k], b = q.setup[k];
    if (a != null && b != null) { if (a !== b) diff.push(`different ${k} (${a} vs ${b})`); }
    else if (a == null && b == null) maybe.push(`${k} not recorded for either`);
    else maybe.push(`${k} recorded for only one of them`);
  }
  if (diff.length) return { status: 'different', reasons: diff };
  if (maybe.length) return { status: 'possible', reasons: maybe };
  return { status: 'same', reasons: [] };
}

/**
 * Compare two selections' whole contributions to one target (each a list of
 * de-duplicated parts). Same only if every part pairs up as the same; any
 * shared or uncertain part without a full match is a possible / partial
 * overlap.
 */
export function compareContributions(A, B, spec, label) {
  const cmp = A.map((p) => B.map((q) => compareParts(p, q, spec, label)));
  const aMatched = A.map((_, i) => cmp[i].some((c) => c.status === 'same'));
  const bMatched = B.map((_, j) => cmp.some((row) => row[j].status === 'same'));
  if (aMatched.every(Boolean) && bMatched.every(Boolean)) return { status: 'same', reasons: [] };
  const anySame = aMatched.some(Boolean);
  const possible = cmp.flat().filter((c) => c.status === 'possible');
  if (anySame || possible.length) {
    const reasons = [];
    if (anySame) reasons.push('part of their contribution matches, but one also covers something the other does not');
    for (const c of possible) for (const r of c.reasons) if (!reasons.includes(r)) reasons.push(r);
    return { status: 'possible', reasons };
  }
  const reasons = [];
  for (const c of cmp.flat()) for (const r of c.reasons) if (!reasons.includes(r)) reasons.push(r);
  return { status: 'different', reasons };
}

/**
 * Analyse one session.
 *   selections: [{ key, name, catalogId }] — one per row in the planner;
 *               set counts are deliberately not part of the input.
 *   cat:        buildCatalogue(...)
 * Returns per-target results plus the selections that couldn't be read.
 */
export function analyseSession(selections, cat) {
  const label = cat.actionLabel;
  const unlinked = [];
  const byTarget = new Map(); // target → [{ sel, rec, parts }]
  const unresolvedBy = new Map(); // action + kind → { label, kind, reason, regions, selections }
  for (const sel of selections) {
    const rec = sel.catalogId ? cat.get(sel.catalogId) : null;
    if (!rec) { unlinked.push({ key: sel.key, name: sel.name, reason: sel.catalogId ? 'catalogue record not found' : 'not linked to a catalogue record' }); continue; }
    if (rec.unrecorded) { unlinked.push({ key: sel.key, name: sel.name, reason: rec.unrecordedReason || 'no muscle action recorded' }); continue; }
    const mine = new Map();
    for (const c of rec.contributions) {
      const p = norm(c);
      if (!mine.has(p.target)) mine.set(p.target, []);
      mine.get(p.target).push(p);
    }
    for (const [target, parts] of mine) {
      if (!byTarget.has(target)) byTarget.set(target, []);
      byTarget.get(target).push({ sel, rec, parts });
    }
    // Regions the record can't confirm (the specification needs a detail it
    // doesn't state). Listed per action, never scored.
    for (const c of rec.candidates || []) {
      if (mine.has(c.target)) continue;
      const k = `${c.atom}|${c.kind}`;
      if (!unresolvedBy.has(k)) unresolvedBy.set(k, { label: c.label || c.atom, kind: c.kind, reason: c.reason, regions: [], selections: [] });
      const u = unresolvedBy.get(k);
      const entry = cat.entryById.get(c.target);
      if (entry && !u.regions.includes(entry)) u.regions.push(entry);
      if (!u.selections.some((x) => x.key === sel.key)) u.selections.push({ key: sel.key, name: sel.name });
    }
  }

  const targets = [];
  for (const [targetId, rows] of byTarget) {
    const entry = cat.entryById.get(targetId);
    const spec = targetSpec(entry);
    const assessable = [], notAssessed = [];
    for (const row of rows) {
      const seen = new Map();
      for (const p of row.parts) seen.set(signature(p, spec), p);
      const parts = [...seen.values()];
      const problems = [...new Set(parts.flatMap((p) => partIssues(p, spec)))];
      if (problems.length) notAssessed.push({ key: row.sel.key, name: row.sel.name, reasons: problems });
      else assessable.push({ ...row, parts });
    }

    // Pairwise relations among assessable selections.
    const rel = new Map();
    const pairKey = (i, j) => (i < j ? `${i}:${j}` : `${j}:${i}`);
    for (let i = 0; i < assessable.length; i++) {
      for (let j = i + 1; j < assessable.length; j++) {
        const a = assessable[i], b = assessable[j];
        const review = cat.equivalence(a.rec.id, b.rec.id, targetId);
        const r = review
          ? { status: review.relation, reasons: [`reviewed: ${review.note || (review.relation === 'same' ? 'marked as the same coverage' : 'marked as different coverage')}`], reviewed: true }
          : a.rec.id === b.rec.id ? { status: 'same', reasons: ['the same record selected twice'], sameRecord: true }
          : compareContributions(a.parts, b.parts, spec, label);
        rel.set(pairKey(i, j), r);
      }
    }

    // Groups: a selection joins a group only if it is confirmed the same as
    // every member, so 'possible' links never merge anything.
    const groups = [];
    assessable.forEach((_, i) => {
      const g = groups.find((members) => members.every((m) => rel.get(pairKey(m, i)).status === 'same'));
      if (g) g.push(i); else groups.push([i]);
    });

    const n = assessable.length, u = groups.length;
    const pairs = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const r = rel.get(pairKey(i, j));
      pairs.push({ a: assessable[i].sel.key, b: assessable[j].sel.key, aName: assessable[i].sel.name, bName: assessable[j].sel.name, ...r });
    }
    targets.push({
      target: entry,
      spec,
      n, u,
      repeated: n - u,
      pct: n ? ((n - u) / n) * 100 : null,
      groups: groups.map((g) => ({
        keys: g.map((i) => assessable[i].sel.key),
        names: g.map((i) => assessable[i].sel.name),
        parts: assessable[g[0]].parts,
      })),
      repeatedPairs: pairs.filter((p) => p.status === 'same'),
      possiblePairs: pairs.filter((p) => p.status === 'possible'),
      differentPairs: pairs.filter((p) => p.status === 'different'),
      notAssessed,
    });
  }
  targets.sort((a, b) => a.target.order - b.target.order);

  // Per selection, one verdict per target — never one verdict for the
  // whole exercise.
  const bySelection = {};
  for (const t of targets) {
    const keysInRepeat = new Set(t.groups.filter((g) => g.keys.length > 1).flatMap((g) => g.keys));
    const keysInPossible = new Set(t.possiblePairs.flatMap((p) => [p.a, p.b]));
    for (const g of t.groups) for (const k of g.keys) {
      (bySelection[k] ||= []).push({ target: t.target.id, verdict: keysInRepeat.has(k) ? 'repeated' : keysInPossible.has(k) ? 'possible' : 'different' });
    }
    for (const x of t.notAssessed) (bySelection[x.key] ||= []).push({ target: t.target.id, verdict: 'not-assessed' });
  }

  const unresolved = [...unresolvedBy.values()].map((u) => ({ ...u, regions: u.regions.sort((a, b) => a.order - b.order) }));
  return { selections: selections.length, unlinked, targets, unresolved, bySelection };
}

/**
 * Planner rows → selections. One row is one selection however many sets it
 * has; set counts are dropped here on purpose.
 */
export function selectionsFromRoutine(routine) {
  // The machine goes in the name so two rows of one exercise stay tellable apart.
  return ((routine && routine.exercises) || []).map((x) => ({
    key: x.id,
    name: x.machine ? `${x.name} (${x.machine.brand} ${x.machine.model || x.machine.name})` : x.name,
    catalogId: x.catalogId || null,
  }));
}

/** Display line for one target, e.g. '50% overlap · 2 repeated selections'. */
export function overlapLine(t) {
  if (!t.n) return 'Insufficient information';
  const pct = Math.round(t.pct);
  return `${pct}% overlap · ${t.repeated} repeated selection${t.repeated === 1 ? '' : 's'}`;
}
