import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MUSCLE_ACTIONS } from '../../muscles/data/muscleActions.js';
import { EXERCISES, EQUIVALENCES } from '../data/catalogue.js';
import { buildCatalogue, actionCatalogue, targetSpec } from '../services/catalogue.js';
import { analyseSession, selectionsFromRoutine, overlapLine, compareParts } from '../services/overlap.js';
import { sessionCoverage, weeklyCoverage } from '../services/coverage.js';
import { sessionPanelHtml, planPanelHtml, recordSelectHtml } from '../ui/overlapPanel.js';
import { FIXTURES, EQUIV, IDS, sel } from './fixtures.js';

const cat = buildCatalogue({ entries: MUSCLE_ACTIONS, exercises: FIXTURES, equivalences: EQUIV });
const empty = buildCatalogue({ entries: MUSCLE_ACTIONS, exercises: EXERCISES, equivalences: EQUIVALENCES });
const run = (...ids) => analyseSession(ids.map((id) => sel(id)), cat);
const target = (res, id) => res.targets.find((t) => t.target.id === id);

test('fixtures are valid against the real muscle-action specification', () => {
  assert.deepEqual(cat.issues, []);
  assert.equal(cat.records.length, FIXTURES.length);
  for (const id of Object.values(IDS)) assert.ok(cat.entryById.has(id) || cat.actions.some((a) => a.id === id), id);
});

test('four assessable selections in two confirmed groups → 50% overlap, 2 repeated', () => {
  const t = target(run('syn-chest-a1', 'syn-chest-a2', 'syn-chest-b1', 'syn-chest-b2'), IDS.CHEST);
  assert.deepEqual([t.n, t.u, t.repeated, t.pct], [4, 2, 2, 50]);
  assert.equal(overlapLine(t), '50% overlap · 2 repeated selections');
});

test('additional sets do not increase exercise-selection overlap', () => {
  const routine = (sets) => ({ exercises: [{ id: 'r1', name: 'Synthetic A', catalogId: 'syn-chest-a1', sets }, { id: 'r2', name: 'Synthetic B', catalogId: 'syn-chest-b1', sets: 2 }] });
  const few = target(analyseSession(selectionsFromRoutine(routine(1)), cat), IDS.CHEST);
  const many = target(analyseSession(selectionsFromRoutine(routine(8)), cat), IDS.CHEST);
  assert.deepEqual([many.n, many.u, many.pct], [few.n, few.u, few.pct]);
  assert.deepEqual([many.n, many.pct], [2, 0]);
  // One exercise with many sets is one selection, not repeated coverage.
  const one = target(analyseSession(selectionsFromRoutine({ exercises: [{ id: 'r1', name: 'x', catalogId: 'syn-chest-a1', sets: 10 }] }), cat), IDS.CHEST);
  assert.deepEqual([one.n, one.repeated, one.pct], [1, 0, 0]);
});

test('sharing only a resistance profile across different muscles is not overlap', () => {
  const r = run('syn-chest-a1', 'syn-delt-desc'); // both DESCENDING
  assert.equal(r.targets.length, 2);
  for (const t of r.targets) assert.deepEqual([t.n, t.repeated, t.pct], [1, 0, 0]);
});

test('sharing target and profile but not the action is not overlap', () => {
  const spec = targetSpec(cat.entryById.get(IDS.CHEST));
  const p = { action: IDS.CHEST_ACT, profile: 'DESCENDING', rom: null, setup: {} };
  assert.equal(compareParts(p, { ...p, action: IDS.CHEST_UP_ACT }, spec).status, 'different');
});

test('repetition across separate sessions is not within-session overlap', () => {
  const day1 = run('syn-chest-a1'), day2 = run('syn-chest-a1');
  assert.equal(target(day1, IDS.CHEST).pct, 0);
  assert.equal(target(day2, IDS.CHEST).pct, 0);
  const weekly = weeklyCoverage([
    { id: 'd1', name: 'Day 1', selections: [sel('syn-chest-a1')], planned: [IDS.CHEST] },
    { id: 'd2', name: 'Day 2', selections: [sel('syn-chest-a1')], planned: [IDS.CHEST] },
  ], cat, { d1: 1, d2: 1 });
  const chest = weekly.find((w) => w.target.id === IDS.CHEST);
  assert.deepEqual([chest.status, chest.perWeek, chest.sessions.length], ['covered', 2, 2]);
});

test('unknown data never produces a misleading 0%', () => {
  const t = target(run('syn-chest-unknown', 'syn-chest-na', 'syn-chest-noaction'), IDS.CHEST);
  assert.equal(t.n, 0);
  assert.equal(t.pct, null);
  assert.equal(overlapLine(t), 'Insufficient information');
  assert.equal(t.notAssessed.length, 3);
  assert.match(t.notAssessed.find((x) => x.name.includes('unknown')).reasons[0], /not specified/);
  // Incomplete selections are excluded from the denominator, and counted.
  const mixed = target(run('syn-chest-a1', 'syn-chest-a2', 'syn-chest-unknown'), IDS.CHEST);
  assert.deepEqual([mixed.n, mixed.repeated, mixed.pct, mixed.notAssessed.length], [2, 1, 50, 1]);
  // Unlinked rows are reported, not scored.
  const unl = analyseSession([{ key: 'k', name: 'Free text', catalogId: null }], cat);
  assert.deepEqual([unl.unlinked.length, unl.targets.length], [1, 0]);
});

test('"Not specified" in the spec keeps the profile relevant; IRRELEVANT and N/A do not', () => {
  const s = (id) => targetSpec(cat.entryById.get(id)).profileMatters;
  assert.equal(s('quadriceps-two-joint-rectus-femoris-upper-region'), true); // Not specified
  assert.equal(s(IDS.QUAD), false);                                       // IRRELEVANT; ASCENDING preferred
  assert.equal(s('adductors-hip-adduction'), false);                      // N/A
  assert.equal(targetSpec(cat.entryById.get(IDS.QUAD)).preferred, 'ASCENDING');
});

test('profile-irrelevant targets compare the remaining fields; "ascending preferred" is never a penalty', () => {
  const t = target(run('syn-quad-asc', 'syn-quad-desc', 'syn-quad-unknown'), IDS.QUAD);
  // All three are assessable (profile not required) and the same coverage.
  assert.deepEqual([t.n, t.u, t.repeated], [3, 1, 2]);
  assert.equal(t.notAssessed.length, 0);
  const cov = sessionCoverage([sel('syn-quad-desc')], cat, [IDS.QUAD]);
  assert.deepEqual(cov.covered.map((c) => c.target.id), [IDS.QUAD]);
});

test('meaningfully different setup or angle prevents automatic duplicates', () => {
  const grip = target(run('syn-chest-grip-wide', 'syn-chest-grip-narrow'), IDS.CHEST);
  // Only the reviewed equivalence makes these the same (see next test); the
  // automatic comparison sees different grips.
  const auto = buildCatalogue({ entries: MUSCLE_ACTIONS, exercises: FIXTURES });
  const g2 = target(analyseSession([sel('syn-chest-grip-wide'), sel('syn-chest-grip-narrow')], auto), IDS.CHEST);
  assert.deepEqual([g2.u, g2.repeated, g2.differentPairs.length], [2, 0, 1]);
  assert.match(g2.differentPairs[0].reasons.join(), /different grip/);
  assert.equal(grip.repeated, 1);

  const disjoint = target(run('syn-glute-0-25', 'syn-glute-45-90'), IDS.GLUTE);
  assert.deepEqual([disjoint.repeated, disjoint.differentPairs.length], [0, 1]);
  const partial = target(run('syn-glute-0-25', 'syn-glute-10-60'), IDS.GLUTE);
  assert.deepEqual([partial.repeated, partial.possiblePairs.length], [0, 1]);
  const same = target(run('syn-glute-0-25', 'syn-glute-0-25-b'), IDS.GLUTE);
  assert.deepEqual([same.repeated, same.pct], [1, 50]);
  // The spec gives an angle range for this target, so no angle data → possible, not confirmed.
  const noAngle = target(run('syn-glute-noangle', 'syn-glute-noangle-b'), IDS.GLUTE);
  assert.deepEqual([noAngle.repeated, noAngle.possiblePairs.length], [0, 1]);
  // A setup detail known for only one → possible, not confirmed.
  const oneSided = target(run('syn-chest-a1', 'syn-chest-grip-wide'), IDS.CHEST);
  assert.deepEqual([oneSided.repeated, oneSided.possiblePairs.length], [0, 1]);
});

test('reviewed equivalences override; unreviewed ones are ignored', () => {
  assert.equal(target(run('syn-chest-grip-wide', 'syn-chest-grip-narrow'), IDS.CHEST).repeated, 1);
  assert.equal(target(run('syn-chest-a1', 'syn-chest-b1'), IDS.CHEST).repeated, 0); // reviewed: false
});

test('different machine names neither prove nor eliminate overlap', () => {
  const t = target(run('syn-lat-machine-x', 'syn-lat-machine-y'), IDS.LAT_UP);
  assert.equal(t.repeated, 1);
});

test('duplicate tags on one record count once', () => {
  const t = target(run('syn-chest-grip-unknown'), IDS.CHEST);
  assert.deepEqual([t.n, t.repeated], [1, 0]);
  assert.equal(t.groups[0].parts.length, 1);
  const pair = target(run('syn-chest-grip-unknown', 'syn-chest-a1'), IDS.CHEST);
  assert.equal(pair.repeated, 1);
});

test('partial sharing is a possible overlap, not a repeated selection', () => {
  const t = target(run('syn-chest-two-actions', 'syn-chest-a1'), IDS.CHEST);
  assert.deepEqual([t.n, t.u, t.repeated], [2, 2, 0]);
  assert.equal(t.possiblePairs.length, 1);
  assert.match(t.possiblePairs[0].reasons[0], /part of their contribution matches/);
});

test('a compound exercise can repeat one target and add different coverage for another', () => {
  const r = run('syn-press', 'syn-chest-a1', 'syn-pushdown');
  assert.equal(target(r, IDS.CHEST).repeated, 1);
  assert.equal(target(r, IDS.TRI).repeated, 0);
  const pressKey = target(r, IDS.CHEST).groups.find((g) => g.keys.length === 2).keys.find((k) => r.bySelection[k].length === 2);
  assert.deepEqual(r.bySelection[pressKey].map((v) => v.verdict).sort(), ['different', 'repeated']);
});

test('coverage uses the intended targets', () => {
  const linked = sessionCoverage([sel('syn-chest-a1')], cat, [IDS.CHEST, IDS.LAT_UP]);
  assert.deepEqual(linked.covered.map((c) => c.target.id), [IDS.CHEST]);
  assert.deepEqual(linked.missing.map((c) => c.target.id), [IDS.LAT_UP]);
  // An unlinked row could cover it, so it can't be called missing.
  const withUnknown = sessionCoverage([sel('syn-chest-a1'), { key: 'u', name: 'Free text', catalogId: null }], cat, [IDS.CHEST, IDS.LAT_UP]);
  assert.deepEqual(withUnknown.undetermined.map((c) => c.target.id), [IDS.LAT_UP]);
  assert.equal(withUnknown.missing.length, 0);
  // A region with a different action than planned doesn't count as covering it.
  const wrongAction = sessionCoverage([sel('syn-chest-two-actions')], cat, ['pectoralis-major-upper-chest']);
  assert.equal(wrongAction.covered.length, 0);
  // No intended targets: observed only, no complete / incomplete claim.
  const none = sessionCoverage([sel('syn-press')], cat, []);
  assert.equal(none.planned, false);
  assert.deepEqual([none.covered.length, none.missing.length], [0, 0]);
  assert.equal(none.observed.length, 2);
  // Not every profile is required: one ascending chest selection covers it.
  assert.equal(sessionCoverage([sel('syn-chest-b1')], cat, [IDS.CHEST]).covered.length, 1);
});

test('invalid records are reported and left out, never repaired', () => {
  const bad = buildCatalogue({ entries: MUSCLE_ACTIONS, exercises: [
    { id: 'syn-bad', name: 'Synthetic bad', contributions: [{ target: 'nope', action: 'hip-extension', profile: 'SIDEWAYS' }] },
    { id: 'syn-irrelevant', name: 'Synthetic irrelevant', contributions: [{ target: IDS.QUAD, action: IDS.QUAD_ACT, profile: 'IRRELEVANT' }] },
  ] });
  assert.equal(bad.records.length, 0);
  assert.equal(bad.issues.length, 2);
  assert.match(bad.issues[0].problems.join(), /unknown target/);
});

test('actions come from the specification and stay distinct by wording', () => {
  const acts = actionCatalogue(MUSCLE_ACTIONS);
  assert.ok(acts.some((a) => a.id === 'hip-extension'));
  assert.ok(acts.some((a) => a.id === 'hip-extension-with-hip-rotated-inwards'));
  assert.equal(new Set(acts.map((a) => a.id)).size, acts.length);
});

test('the live catalogue is empty and the interface handles it', () => {
  assert.equal(EXERCISES.length, 0);
  assert.equal(EQUIVALENCES.length, 0);
  assert.equal(empty.records.length, 0);
  const routine = { id: 'r', name: 'Upper', exercises: [{ id: 'x', name: 'Bench Press', sets: 3 }] };
  assert.match(sessionPanelHtml(routine, empty), /exercise catalogue is empty/);
  assert.match(planPanelHtml({ routines: [routine] }, empty, {}), /catalogue/);
  assert.equal(recordSelectHtml(routine.exercises[0], empty, ''), '');
  const a = analyseSession(selectionsFromRoutine(routine), empty);
  assert.deepEqual([a.unlinked.length, a.targets.length], [1, 0]);
});

test('panel wording stays neutral', () => {
  const routine = { id: 'r', name: 'S', targets: [IDS.CHEST, IDS.LAT_UP], exercises: ['syn-chest-a1', 'syn-chest-a2', 'syn-chest-unknown', 'syn-glute-0-25', 'syn-glute-10-60'].map((c, i) => ({ id: 'x' + i, name: 'Synthetic ' + i, catalogId: c })) };
  const html = sessionPanelHtml(routine, cat) + planPanelHtml({ routines: [routine] }, cat, { r: 2 });
  assert.match(html, /50% overlap · 1 repeated selection/);
  assert.match(html, /Possible overlap/);
  assert.match(html, /Insufficient information/);
  assert.doesNotMatch(html, /wasted|bad exercise|redundant|useless/i);
});
