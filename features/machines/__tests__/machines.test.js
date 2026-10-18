import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { MACHINE_ROWS, MACHINE_DB_META } from '../data/machines.js';
import { NEW_EXERCISES, LIBRARY, FAMILIES, CABLE_EXERCISES, SMITH_EXERCISES, SMITH_RELATED } from '../data/exercises.js';
import { parseMachineCsv, assignIds, SOURCE_FILE, COLUMNS } from '../services/source.js';
import { parseAction, ATOMS } from '../services/actions.js';
import { readEntry } from '../services/muscles.js';
import { parseProfile, overlapProfile } from '../services/profile.js';
import { createMachineDb, recordId, UNLISTED, UNRECORDED } from '../services/db.js';
import { MUSCLE_ACTIONS } from '../../muscles/data/muscleActions.js';
import { buildCatalogue } from '../../exercises/services/catalogue.js';
import { analyseSession } from '../../exercises/services/overlap.js';
import { sessionCoverage } from '../../exercises/services/coverage.js';
import { buildModule, buildReview } from '../../../scripts/build-machine-db.mjs';
import { chosenHtml, detailsHtml, addChoices, muscleSummary, addRowHtml, addChoiceHtml } from '../ui/machineUI.js';

const here = new URL('.', import.meta.url);
const csvBytes = readFileSync(new URL(`../data/${SOURCE_FILE}`, here));
const csvRows = parseMachineCsv(csvBytes.toString('utf8'));
const db = createMachineDb(MACHINE_ROWS, MUSCLE_ACTIONS);
const byName = (name, brand) => {
  const hits = db.machines.filter((m) => m.name === name && (!brand || m.brand === brand));
  assert.equal(hits.length, 1, `${brand || ''} ${name}: ${hits.length} matches`);
  return hits[0];
};
const exNames = (m) => m.exercises.map((e) => `${e.name}@${e.mode}`);
// One region can be reached through two recorded movements (a press's flexion and abduction).
const targetIds = (m, mode = 'main') => [...new Set(m.modes.find((x) => x.key === mode).targets.map((t) => t.entry.id))].sort();
const candidateIds = (m, mode = 'main') => m.modes.find((x) => x.key === mode).candidates.map((c) => c.entry.id).sort();
const flagCodes = (m) => m.flags.map((f) => f.code);

// The app's exercise library, from js/fitness.js as the browser loads it.
const fitnessCtx = { window: {} };
vm.runInNewContext(readFileSync(new URL('../../../js/fitness.js', here), 'utf8'), fitnessCtx);
const F = fitnessCtx.window.Fitness;
const LIB = new Set(F.EXERCISE_NAMES);

// ── Import ───────────────────────────────────────────────────────────────
test('all 913 rows are imported once, verbatim and in file order', () => {
  assert.equal(csvRows.length, 913);
  assert.equal(MACHINE_ROWS.length, 913);
  assert.equal(MACHINE_DB_META.rowCount, 913);
  assert.deepEqual(MACHINE_DB_META.columns, COLUMNS);
  assert.deepEqual(MACHINE_ROWS, csvRows); // every cell exactly as written
  assert.equal(MACHINE_DB_META.sha256, createHash('sha256').update(csvBytes).digest('hex'));
  assert.equal(db.machines.length, 913);
  assert.deepEqual(db.machines.map((m) => m.row), csvRows.map((_, i) => i + 2));
});

test('the generated module and review report are up to date with the CSV', () => {
  assert.equal(buildModule(csvBytes), readFileSync(new URL('../data/machines.js', here), 'utf8'));
  assert.equal(buildReview(csvBytes), readFileSync(new URL('../REVIEW.md', here), 'utf8'));
});

test('no duplicates: ids are unique and stable, rows are distinct', () => {
  const ids = db.machines.map((m) => m.id);
  assert.equal(new Set(ids).size, 913);
  assert.deepEqual(assignIds(csvRows), ids);
  assert.equal(new Set(csvRows.map((r) => r.join('\u0001'))).size, 913, 'no exact duplicate rows');
  assert.equal(new Set(csvRows.map((r) => r.slice(0, 4).join('\u0001'))).size, 913, 'brand+line+machine+model is unique');
  assert.equal(byName('Iso-Lateral Row').id, 'hammer-strength-il-row');
  // A model code shared by two rows keeps both, with the name in the id.
  const vft = db.machines.filter((m) => m.model === 'VS-VFT');
  assert.equal(vft.length, 2);
  assert.notEqual(vft[0].id, vft[1].id);
});

test('brand counts match the file', () => {
  const counts = Object.fromEntries(db.options().brands.map((b) => [b.name, b.count]));
  assert.deepEqual(counts, { Atlantis: 86, 'Hammer Strength': 80, 'Life Fitness': 66, Matrix: 104, Nautilus: 99, Panatta: 282, PRIME: 62, Technogym: 134 });
});

test('the parser refuses rows it does not understand', () => {
  assert.throws(() => parseMachineCsv('Brand,Line\r\n'), /Unexpected header/);
  assert.throws(() => parseMachineCsv(`${COLUMNS.join(',')}\n,,x,,,,,,`), /Brand and Machine/);
  assert.throws(() => parseMachineCsv(`${COLUMNS.join(',')}\nA,B,C\n`), /cells/);
  assert.throws(() => parseAction('Knee flexion and wiggling.'), /Unrecognised/);
  assert.throws(() => parseAction('Foo mode: knee flexion.'), /mode label/);
  assert.throws(() => parseProfile('Mostly ascending'), /Unrecognised/);
});

// ── Actions ──────────────────────────────────────────────────────────────
test('every recorded muscle action parses; blank ones record nothing', () => {
  const blank = db.machines.filter((m) => !m.recorded);
  assert.equal(blank.length, 116);
  for (const m of blank) assert.equal(m.action, '');
  for (const m of db.machines.filter((x) => x.recorded)) assert.ok(m.modes.length >= 1, m.name);
});

test('modes, alternatives, notes and conditional actions are kept as written', () => {
  const pr = parseAction('Pulldown: shoulder adduction/extension and elbow flexion; row: shoulder extension, elbow flexion and scapular retraction.');
  assert.deepEqual(pr.modes.map((m) => [m.key, m.label, m.atoms]), [
    ['pulldown', 'Pulldown', ['shoulder-adduction', 'shoulder-extension', 'elbow-flexion']],
    ['row', 'Row', ['shoulder-extension', 'elbow-flexion', 'scapular-retraction']]]);
  const row = parseAction('Shoulder extension, elbow flexion and scapular retraction; humeral plane depends on grip.');
  assert.deepEqual([row.modes.length, row.modes[0].notes, row.modes[0].flags], [1, ['humeral plane depends on grip'], ['plane-depends-on-grip']]);
  const ghd = parseAction('Knee flexion; hip extension may be added through a combined glute-ham raise.');
  assert.deepEqual([ghd.modes[0].atoms, ghd.modes[0].conditional], [['knee-flexion'], ['hip-extension']]);
  const dl = parseAction('Hip extension, with knee extension depending on technique.');
  assert.deepEqual([dl.modes[0].atoms, dl.modes[0].conditional], [['hip-extension'], ['knee-extension']]);
  const hip = parseAction('By mode: hip flexion, extension, abduction or adduction.');
  assert.deepEqual(hip.modes.map((m) => m.key), ['hip-flexion', 'hip-extension', 'hip-abduction', 'hip-adduction']);
  const ov = parseAction('Chest modes: shoulder horizontal flexion/flexion and elbow extension; overhead mode: shoulder elevation and elbow extension.');
  assert.deepEqual(ov.modes[1].atoms, ['shoulder-flexion', 'shoulder-abduction', 'elbow-extension']);
  assert.match(ov.modes[1].notes[0], /elevation/);
});

// ── Muscles: derived, never invented ─────────────────────────────────────
test('every target comes from the specification by its own wording', () => {
  const ids = new Set(MUSCLE_ACTIONS.map((e) => e.id));
  for (const m of db.machines) for (const md of m.modes) {
    for (const t of md.targets) {
      assert.ok(ids.has(t.entry.id));
      const read = readEntry(t.entry);
      assert.equal(read.context, null, `${m.name}: a target never needs a qualifier`);
      assert.ok(read.atoms.includes(t.atom), `${m.name}: ${t.entry.muscle} is not "${ATOMS[t.atom]}"`);
      assert.ok(md.atoms.includes(t.atom), `${m.name}: target via an action the row doesn't record`);
      assert.equal(t.basis, read.either ? 'either' : 'exact');
    }
    for (const c of md.candidates) {
      if (c.kind === 'context') assert.ok(readEntry(c.entry).context, `${m.name}: context candidate without a qualifier`);
      if (c.kind === 'conditional') assert.ok(md.conditional.includes(c.atom));
      if (c.kind === 'compound-part') assert.equal(c.atom, 'knee-and-hip-extension');
      assert.ok(!md.targets.some((t) => t.entry.id === c.entry.id), 'a region is never both target and unresolved');
    }
  }
});

test('actions outside the muscle list stay unmapped instead of being assigned', () => {
  const unmapped = new Set(db.machines.flatMap((m) => m.modes.flatMap((md) => md.unmapped)));
  assert.deepEqual([...unmapped].sort(), [
    'ankle-dorsiflexion', 'cervical-extension', 'cervical-flexion', 'cervical-lateral-flexion', 'finger-flexion',
    'forearm-pronation', 'forearm-supination', 'scapular-elevation', 'shoulder-external-rotation', 'shoulder-internal-rotation',
    'trunk-extension', 'trunk-flexion', 'trunk-rotation', 'wrist-extension', 'wrist-flexion']);
  const shrug = byName('Shrug Machine');
  assert.deepEqual([targetIds(shrug), shrug.modes[0].unmapped], [[], ['scapular-elevation']]);
  assert.ok(shrug.groups.includes(UNLISTED));
  // The specification's "Pulls clavicle backwards" is not scapular elevation.
  assert.ok(!db.machines.some((m) => m.modes.some((md) => md.targets.some((t) => t.entry.id === 'trapezius-upper'))));
});

test('pulldowns, rows and presses map to the regions their actions name', () => {
  const pd = byName('Lat Pulldown', 'Atlantis');
  assert.deepEqual(targetIds(pd), ['latissimus-dorsi-lower', 'latissimus-dorsi-upper', 'pectoralis-major-lower-chest']);
  assert.deepEqual(candidateIds(pd), ['elbow-flexors-biceps-brachii', 'elbow-flexors-brachialis', 'elbow-flexors-brachioradialis']);
  assert.ok(pd.groups.includes('Elbow flexors'), 'the group is certain even when the region is not');
  const row = byName('Low Row', 'Atlantis');
  assert.deepEqual(targetIds(row), ['latissimus-dorsi-upper', 'pectoralis-major-lower-chest', 'trapezius-middle-and-lower']);
  assert.ok(flagCodes(row).includes('plane-depends-on-grip'));
  const cp = byName('Artis Chest Press');
  assert.deepEqual(targetIds(cp), ['pectoralis-major-middle-chest']);
  assert.deepEqual(candidateIds(cp), ['triceps-brachii-lateral-and-medial-heads', 'triceps-brachii-long-head']);
  const sp = byName('Artis Shoulder Press');
  assert.deepEqual(targetIds(sp), ['deltoid-anterior', 'deltoid-middle', 'pectoralis-major-upper-chest']);
  assert.deepEqual(sp.modes[0].targets.filter((t) => t.entry.id === 'deltoid-anterior').map((t) => t.atom).sort(), ['shoulder-abduction', 'shoulder-flexion']);
  const lr = byName('Artis Abductor').modes[0];
  assert.deepEqual(lr.targets.map((t) => t.entry.id), ['abductors-hip-abduction']);
  assert.deepEqual(lr.candidates.map((c) => c.entry.id), ['gluteus-maximus-upper']);
  assert.ok(!byName('Artis Abductor').groups.includes('Gluteus maximus'), 'a possible region does not become a certain group');
  // "Shoulder flexion or abduction" is met by abduction alone.
  const raise = byName('Standing lateral raise');
  assert.deepEqual(raise.modes[0].targets.map((t) => [t.entry.id, t.basis]).sort(), [['deltoid-anterior', 'either'], ['deltoid-middle', 'exact']]);
});

test('legs: compound and context-dependent actions are not over-claimed', () => {
  const lp = byName('Artis Leg Press');
  assert.deepEqual(targetIds(lp), ['quadriceps-squat-pattern']);
  assert.ok(lp.modes[0].candidates.every((c) => c.kind === 'compound-part'));
  assert.ok(candidateIds(lp).includes('gluteus-maximus-lower'));
  const curl = byName('Seated leg curl', 'Atlantis');
  assert.deepEqual(targetIds(curl), ['hamstrings-lower']);
  assert.equal(curl.modes[0].candidates.length, 3);
  const ext = byName('Artis Leg Extension');
  assert.deepEqual([targetIds(ext), candidateIds(ext)], [['quadriceps-two-joint-rectus-femoris-lower-region'], ['quadriceps-single-joint-quadriceps']]);
  const thrust = byName('Hip Thruster Pro');
  assert.deepEqual(targetIds(thrust), ['adductors-hip-extension', 'gluteus-maximus-lower', 'hamstrings-upper']);
  const calf = byName('Seated calf', 'Atlantis');
  assert.deepEqual([targetIds(calf), calf.groups], [[], ['Calves']]);
  const ghd = byName('Assisted glute and ham developer');
  assert.ok(ghd.modes[0].candidates.some((c) => c.kind === 'conditional' && c.entry.id === 'gluteus-maximus-lower'));
});

// ── Exercises ────────────────────────────────────────────────────────────
test('every exercise name is a library exercise or a declared machine exercise', () => {
  for (const n of LIBRARY) assert.ok(LIB.has(n), `library is missing ${n}`);
  for (const [n, def] of Object.entries(NEW_EXERCISES)) {
    assert.ok(!LIB.has(n), `${n} already exists in the library`);
    if (def.like) assert.ok(LIB.has(def.like), `${n} borrows from missing ${def.like}`);
    if (def.aliases) for (const a of [...def.aliases.primary, ...def.aliases.secondary]) assert.ok(F.MUSCLE_ALIAS[a], `unknown alias ${a}`);
  }
  const known = new Set([...LIB, ...Object.keys(NEW_EXERCISES)]);
  for (const f of FAMILIES) for (const n of f.exercises) assert.ok(known.has(n), `family ${f.key}: ${n}`);
  for (const n of [...CABLE_EXERCISES, ...SMITH_EXERCISES, ...SMITH_RELATED]) assert.ok(LIB.has(n), n);
  for (const m of db.machines) for (const e of m.exercises) assert.ok(known.has(e.name), `${m.name}: ${e.name}`);
});

test('every machine is matched, a station, or flagged unmatched', () => {
  const unmatched = db.machines.filter((m) => !m.station && !m.exercises.length);
  assert.deepEqual(unmatched.map((m) => m.name).sort(), ['Ground Base Jammer', 'Hammer Strength Select Hip and Glute', 'HumanSport Arm Crunch',
    'HumanSport Pull Lift', 'HumanSport Shoulder Chest', 'HumanSport Total Delts', 'HumanSport Total Legs', 'Power runner', 'Power runner']);
  for (const m of unmatched) assert.ok(flagCodes(m).includes('unmatched'));
  for (const m of db.machines.filter((x) => x.recorded)) assert.ok(m.exercises.some((e) => e.basis === 'name' || e.basis === 'action'), m.name);
  const o = db.options();
  assert.deepEqual(o.stations.map((s) => [s.key, s.count]), [['cable', 73], ['smith', 12], ['multi', 22]]);
  assert.equal(o.unmatched, 9);
});

test('names choose the exercise within the recorded movement', () => {
  assert.deepEqual(exNames(byName('Seated leg curl', 'Atlantis')), ['Seated Leg Curl@main']);
  assert.deepEqual(exNames(byName('Lying leg curl', 'Atlantis')), ['Prone Leg Curl@main']);
  assert.deepEqual(exNames(byName('Kneeling leg curl', 'Atlantis')), ['Kneeling Leg Curl@main']);
  assert.deepEqual(exNames(byName('Standing leg curl', 'Atlantis')), ['Standing Leg Curl@main']);
  assert.deepEqual(exNames(byName('Decline / Flat converging bench press')), ['Decline Machine Press@main', 'Converging Chest Press@main']);
  assert.deepEqual(exNames(byName('Iso-Lateral Chest / Back')), ['Flat Machine Chest Press@chest-press', 'Lat Pulldown@pulldown']);
  assert.deepEqual(exNames(byName('Magnum Squat / Lunge')), ['Machine Squat@main', 'Lunge@main']);
  assert.deepEqual(exNames(byName('Magnum Reclining Leg Extension')), ['Reclined Leg Extension@main']);
  assert.deepEqual(exNames(byName('Incline T-Bar Row')), ['T-Bar Row@main']);
  for (const m of db.machines.filter((x) => x.name === 'Pulley row')) assert.deepEqual(exNames(m), ['Cable Row@main']);
  assert.deepEqual(exNames(byName('Assisted chin/dip')), ['Assisted Pull-Up@chin', 'Assisted Dip@dip']);
  assert.deepEqual(exNames(byName('Leg extension/Leg curl combo')), ['Leg Extension@extension', 'Leg Curl@curl']);
  assert.deepEqual(exNames(byName('Multi-forearm')).length, 5);
  assert.deepEqual(exNames(byName('Magnum Smith Machine')), ['Smith Machine Squat@null', 'Low-Incline Smith Press@null']);
  assert.equal(byName('Magnum Smith Machine').station, 'smith');
  assert.equal(byName('Cable Crossover', 'Technogym').station, 'cable');
  assert.equal(byName('Multipower').station, 'multi');
});

test('name/action conflicts and unnamed modes are flagged, not resolved', () => {
  const pek = byName('Vertical Pek Dek');
  assert.deepEqual([exNames(pek), flagCodes(pek).includes('name-action-mismatch')], [['Pec Deck@main'], true]);
  for (const n of ['Biostrength Reverse Fly', 'Selection 900 Reverse Fly']) {
    const m = byName(n);
    assert.deepEqual(exNames(m), ['Reverse Pec Deck@main']);
    assert.deepEqual(targetIds(m), ['pectoralis-major-middle-chest'], 'targets follow the recorded action');
    assert.ok(flagCodes(m).includes('name-action-mismatch'));
  }
  const isoRow = byName('Iso-Lateral Row');
  assert.deepEqual(exNames(isoRow), ['Machine Row@row']);
  assert.ok(flagCodes(isoRow).includes('mode-not-in-name'));
  assert.equal(db.machines.filter((m) => flagCodes(m).includes('mode-not-in-name')).length, 11);
  const dip = byName('Impact Dip Machine');
  assert.deepEqual(exNames(dip), ['Machine Dip@dip']);
  const station = byName('Chin Up / Dip / Leg Raise');
  assert.deepEqual(exNames(station), ['Pull-Up@chin', 'Dip@dip', 'Hanging Leg Raise@null']);
  assert.ok(flagCodes(station).includes('name-mentions-unrecorded'));
  const pivot = byName('Pivot press');
  assert.deepEqual([exNames(pivot), pivot.exercises[0].basis, flagCodes(pivot).includes('matched-by-action')], [['Machine Squat@main'], 'action', true]);
  assert.equal(db.machines.filter((m) => flagCodes(m).includes('shared-model')).length, 2);
  assert.equal(db.machines.filter((m) => flagCodes(m).includes('shared-name')).length, 6);
  assert.equal(db.machines.filter((m) => flagCodes(m).includes('no-model')).length, 10);
  assert.equal(db.machines.filter((m) => flagCodes(m).includes('no-source')).length, 9);
});

test('machines for an exercise: exact first, then the same movement, then stations', () => {
  const pd = db.forExercise('Lat Pulldown');
  assert.equal(pd.exact.length, 63);
  assert.ok(pd.exact.every((x) => x.machine.exercises.some((e) => e.name === 'Lat Pulldown')));
  const sq = db.forExercise('Squat');
  assert.equal(sq.exact.length, 0);
  assert.ok(sq.related.length > 0 && sq.stations.length === 12, 'barbell squat: related machines and Smith machines only');
  const fly = db.forExercise('Cable Fly');
  assert.equal(fly.exact.length, 73, 'every cable station');
  assert.ok(fly.stations.every((x) => x.machine.station === 'multi'));
  assert.equal(db.exactCount('Lat Pulldown'), 63);
  assert.equal(db.exactCount('Bench Press'), 0);
});

// ── Profiles ─────────────────────────────────────────────────────────────
test('profiles: every wording categorised, raw text kept, only fixed curves compared', () => {
  const cats = new Map();
  for (const m of db.machines) cats.set(m.profile.category, (cats.get(m.profile.category) || 0) + 1);
  assert.deepEqual(Object.fromEntries(cats), {
    'EXERCISE-DEPENDENT': 172, 'BELL-SHAPED': 469, ASCENDING: 44, DESCENDING: 48, CONSTANT: 39, VARIABLE: 71,
    ADJUSTABLE: 52, 'MODE-DEPENDENT': 15, SELECTABLE: 1, 'CONFIGURATION-DEPENDENT': 2 });
  for (const m of db.machines) assert.equal(m.profile.raw, m.profileText);
  assert.equal(overlapProfile(parseProfile('Bell-shaped')), 'BELL-SHAPED', 'kept apart from the specification\'s MID-RANGE');
  assert.equal(overlapProfile(parseProfile('Exercise-dependent: near-constant cable tension')), 'Not specified');
  assert.equal(overlapProfile(parseProfile('Variable: cam-shaped (exact curve unpublished)')), 'Not specified');
  assert.equal(parseProfile('Selectable: top-loaded descending; bottom-loaded ascending').detail, 'top-loaded descending; bottom-loaded ascending');
});

// ── Search and filters ───────────────────────────────────────────────────
test('search and filters by muscle group, brand and exercise', () => {
  assert.equal(db.search({ group: 'Calves' }).length, 32);
  assert.equal(db.search({ brand: 'PRIME' }).length, 62);
  assert.equal(db.search({ exercise: 'Lat Pulldown' }).length, 63);
  assert.equal(db.search({ exercise: 'station:smith' }).length, 12);
  assert.equal(db.search({ exercise: 'unmatched' }).length, 9);
  assert.equal(db.search({ group: UNRECORDED }).length, 116);
  const hs = db.search({ text: 'hammer iso-lateral row' });
  assert.ok(hs.length >= 5 && hs.every((m) => m.brand === 'Hammer Strength'));
  assert.ok(db.search({ text: 'IL-ROW' }).some((m) => m.model === 'IL-ROW'), 'model codes are searchable');
  assert.ok(db.search({ text: 'leg press 45°' }).length >= 2, 'symbols in names are searchable');
  assert.deepEqual(db.search({ brand: 'Matrix', group: 'Hamstrings', exercise: 'Seated Leg Curl' }).map((m) => m.name).sort(),
    ['Go Series Seated Leg Curl', 'Ultra Base Trim Seated Leg Curl', 'Ultra Seated Leg Curl', 'Versa Seated Leg Curl']);
  const total = db.options().brands.reduce((n, b) => n + b.count, 0);
  assert.equal(total, 913);
});

// ── Overlap with real machines ───────────────────────────────────────────
const cat = buildCatalogue({ entries: MUSCLE_ACTIONS, exercises: db.records() });
let k = 0;
const pick = (m, mode = 'main') => ({ key: `s${++k}`, name: m.name, catalogId: recordId(m.id, mode) });
const target = (res, id) => res.targets.find((t) => t.target.id === id);

test('every machine record passes catalogue validation', () => {
  assert.deepEqual(cat.issues, []);
  assert.equal(cat.records.length, db.records().length);
});

test('two pulldown machines repeat lat coverage; the same machine twice is repeated too', () => {
  const r = analyseSession([pick(byName('Lat Pulldown', 'Atlantis')), pick(byName('Artis Lat Machine'))], cat);
  const lower = target(r, 'latissimus-dorsi-lower');
  assert.deepEqual([lower.n, lower.u, lower.pct], [2, 1, 50]);
  const ext = byName('Artis Leg Extension');
  const twice = target(analyseSession([pick(ext), pick(ext)], cat), 'quadriceps-two-joint-rectus-femoris-lower-region');
  assert.deepEqual([twice.repeated, twice.repeatedPairs[0].sameRecord], [1, true]);
});

test('details the specification relies on but the records lack make overlap only possible', () => {
  const r = analyseSession([pick(byName('Artis Leg Extension')), pick(byName('Axiom Series Leg Extension'))], cat);
  const rf = target(r, 'quadriceps-two-joint-rectus-femoris-lower-region');
  assert.deepEqual([rf.n, rf.repeated, rf.possiblePairs.length], [2, 0, 1]);
  assert.match(rf.possiblePairs[0].reasons.join(), /hip position not recorded/);
});

test('setting-dependent profiles are not assessed where the profile matters', () => {
  const prime = byName('EVOLUTION | Chest Press');
  const r = analyseSession([pick(prime), pick(byName('Artis Chest Press'))], cat);
  const chest = target(r, 'pectoralis-major-middle-chest');
  assert.deepEqual([chest.n, chest.notAssessed.length], [1, 1]);
  assert.match(chest.notAssessed[0].reasons[0], /Adjustable: 5 SmartStrength curves/);
});

test('unresolved regions are listed, possibly overlapping, never scored', () => {
  const r = analyseSession([pick(byName('Biceps curl', 'Atlantis')), pick(byName('Artis Arm Curl'))], cat);
  assert.equal(r.targets.length, 0);
  assert.equal(r.unresolved.length, 1);
  assert.deepEqual([r.unresolved[0].label, r.unresolved[0].selections.length], ['Elbow flexion', 2]);
  assert.deepEqual(r.unresolved[0].regions.map((e) => e.group), ['Elbow flexors', 'Elbow flexors', 'Elbow flexors']);
});

test('stations and unrecorded uses are not assessed, with the reason', () => {
  const r = analyseSession([pick(byName('Cable Crossover', 'Technogym'), null)], cat);
  assert.match(r.unlinked[0].reason, /no muscle action recorded/);
  const named = byName('Versa Bicep / Tricep');
  const t = analyseSession([pick(named, null)], cat);
  assert.match(t.unlinked[0].reason, /doesn't cover this exercise/);
});

test('coverage: confirmed targets cover, unresolved ones cannot be determined', () => {
  const sel = [pick(byName('Lat Pulldown', 'Atlantis')), pick(byName('Biceps curl', 'Atlantis')), pick(byName('Artis Leg Press'))];
  const cov = sessionCoverage(sel, cat, ['latissimus-dorsi-lower', 'elbow-flexors-biceps-brachii', 'gluteus-maximus-lower', 'calves-soleus']);
  assert.deepEqual(cov.covered.map((c) => c.target.id), ['latissimus-dorsi-lower']);
  assert.deepEqual(cov.undetermined.map((c) => c.target.id).sort(), ['elbow-flexors-biceps-brachii', 'gluteus-maximus-lower']);
  assert.deepEqual(cov.missing.map((c) => c.target.id), ['calves-soleus']);
});

// ── Display ──────────────────────────────────────────────────────────────
test('the chosen-machine block shows brand, model, profile, action and muscles', () => {
  const m = byName('Lat Pulldown', 'Atlantis');
  const html = chosenHtml(db.snapshot(m, 'main'));
  for (const s of ['Atlantis', 'Lat Pulldown', 'RD123', 'Bell-shaped', 'Shoulder adduction/extension and elbow flexion.',
    'Latissimus dorsi — Lower', 'Pectoralis major — Lower chest', 'Elbow flexors · region not recorded']) assert.ok(html.includes(s), s);
  const combo = byName('Leg extension/Leg curl combo');
  const curl = chosenHtml(db.snapshot(combo, 'curl'));
  assert.ok(curl.includes('Curl mode: knee flexion') && curl.includes('Hamstrings — Lower') && !curl.includes('rectus femoris'));
});

test('the details sheet shows every field, escaped, with only http(s) links', () => {
  const m = byName('Versa Functional Trainer w/18” Storage');
  const html = detailsHtml(m);
  for (const s of ['Matrix · Versa', 'Model VS-VFT', 'Exercise-dependent', 'near-constant cable tension', 'Mechanical inference',
    'Cable station', 'Not recorded', 'Model VS-VFT is shared with']) assert.ok(html.includes(s), s);
  assert.ok(html.includes('href="https://pmc.ncbi.nlm.nih.gov/articles/PMC6262970/"'));
  const pek = detailsHtml(byName('Vertical Pek Dek'));
  assert.ok(pek.includes('Notes for review') && pek.includes('pec deck (a fly)'));
  assert.ok(!detailsHtml({ ...m, sourceUrl: 'javascript:alert(1)' }).includes('javascript:'));
  const lr = muscleSummary(byName('Standing lateral raise'), 'main');
  assert.deepEqual(lr.targets.map((t) => t.entry.id).sort(), ['deltoid-anterior', 'deltoid-middle']);
});

test('adding from the browser: one choice per matched exercise, stations offer theirs', () => {
  assert.deepEqual(addChoices(byName('Leg extension/Leg curl combo')).map((c) => c.name), ['Leg Extension', 'Leg Curl']);
  assert.ok(addChoices(byName('Magnum Smith Machine')).some((c) => c.name === 'Smith Machine Squat'));
  assert.deepEqual(addChoices(byName('Ground Base Jammer')), [{ name: 'Ground Base Jammer', mode: null }]);
});

test('add-exercise rows show every machine with its resistance profile and muscle action', () => {
  for (const m of db.machines) {
    const html = addRowHtml(m);
    assert.ok(html.includes(`data-id="${m.id}"`), m.id);
    assert.ok(html.includes(db.profileLabel(m.profile)), `${m.id}: profile`);
  }
  const pd = addRowHtml(byName('Lat Pulldown', 'Atlantis'));
  for (const s of ['Lat Pulldown', 'Atlantis · Athletic Series', 'RD123', 'Bell-shaped', 'Shoulder adduction/extension and elbow flexion.']) assert.ok(pd.includes(s), s);
  const cable = addRowHtml(db.machines.find((m) => m.model === 'RX200-L'));
  assert.ok(cable.includes('near-constant cable tension') && cable.includes('No muscle action recorded'));
  assert.ok(addRowHtml(byName('Versa Functional Trainer w/18” Storage')).includes('w/18” Storage'));
});

test('machines serving several exercises ask which one; stations offer a list', () => {
  const combo = addChoiceHtml(byName('Leg extension/Leg curl combo'));
  assert.ok(combo.includes('Leg Extension · Extension mode') && combo.includes('Leg Curl · Curl mode'));
  const station = addChoiceHtml(byName('Cable Crossover', 'Technogym'));
  assert.ok(station.includes('<select') && station.includes('Cable Fly'));
});
