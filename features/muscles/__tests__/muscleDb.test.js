import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MUSCLE_ACTIONS, MUSCLE_DB_NOTES, MUSCLE_DB_META } from '../data/muscleActions.js';
import { parseProfile, rebuildProfile, parseSource, PROFILE_TYPES } from '../services/parse.js';
import { loadLinks, exercisesFor, linkExercise, unlinkExercise, LINKS_KEY } from '../repositories/exerciseLinks.js';
import { buildModule } from '../../../scripts/build-muscle-db.mjs';

const here = new URL('.', import.meta.url);
const csvBytes = readFileSync(new URL('../data/Muscle_Actions_Updated_Profiles.csv', here));
// Expected values read from the .xlsx by a separate (Python, XML-based) parser.
const xlsx = JSON.parse(readFileSync(new URL('./fixtures/expected-from-xlsx.json', here), 'utf8'));
const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m }; };

test('all 34 entries match the source exactly, in order', () => {
  assert.equal(MUSCLE_ACTIONS.length, 34);
  assert.equal(xlsx.entries.length, 34);
  MUSCLE_ACTIONS.forEach((e, i) => {
    assert.deepEqual([e.muscle, e.resistanceProfile, e.muscleAction], xlsx.entries[i], `row ${i + 2}`);
    assert.equal(e.sourceRow, i + 2);
    assert.equal(e.order, i + 1);
  });
});

test('the generated module is up to date with the CSV', () => {
  assert.equal(buildModule(csvBytes), readFileSync(new URL('../data/muscleActions.js', here), 'utf8'));
  assert.equal(MUSCLE_DB_META.entryCount, 34);
});

test('notes are documentation, not records', () => {
  assert.equal(MUSCLE_DB_NOTES.title, 'Update notes');
  assert.deepEqual(MUSCLE_DB_NOTES.items.map((n) => [n.topic, n.status, n.detail]), xlsx.notes.items);
  const names = new Set(MUSCLE_ACTIONS.map((e) => e.muscle));
  for (const n of MUSCLE_DB_NOTES.items) assert.ok(!names.has(n.topic), `${n.topic} imported as an entry`);
  assert.ok(!names.has('Update notes'));
});

test('IRRELEVANT, ASCENDING preferred, N/A and Not specified stay distinct', () => {
  const at = (row) => MUSCLE_ACTIONS.find((e) => e.sourceRow === row).profile;
  assert.deepEqual([at(25).type, at(25).preferred, at(25).qualification], ['IRRELEVANT', 'ASCENDING', 'ASCENDING preferred']);
  assert.deepEqual([at(19).type, at(19).context, at(19).preferred], ['IRRELEVANT', 'knee flexion', null]);
  assert.deepEqual([at(26).type, at(26).context, at(26).qualification], ['Not specified', null, null]);
  assert.deepEqual([at(33).type, at(33).context], ['N/A', null]);
  assert.deepEqual([at(17).type, at(17).context], ['N/A', 'hip abduction']);
  const count = (t) => MUSCLE_ACTIONS.filter((e) => e.profile.type === t).length;
  assert.deepEqual(PROFILE_TYPES.map(count), [7, 15, 2, 6, 3, 1]); // ASC, DESC, MID, IRR, N/A, Not specified
});

test('angle ranges and qualifications are kept as written, nothing added', () => {
  const p = (row) => MUSCLE_ACTIONS.find((e) => e.sourceRow === row).profile;
  assert.deepEqual([p(18).angleRange, p(18).angleStart, p(18).angleEnd, p(18).angleReference], ['25–0°', 25, 0, 'hip flexion']);
  assert.deepEqual([p(21).angleRange, p(21).angleReference], ['75–25°', 'hip flexion']);
  assert.deepEqual([p(32).angleRange, p(32).angleReference], ['90–75°', 'hip flexion']);
  // Squat range: the source gives no joint convention, so none is recorded.
  assert.deepEqual([p(35).angleRange, p(35).angleReference, p(35).qualification], ['30–70°', null, '30–70° range']);
  for (const e of MUSCLE_ACTIONS) {
    assert.equal(rebuildProfile(e.profile), e.resistanceProfile, e.id);
    for (const v of [e.profile.context, e.profile.qualification, e.profile.angleRange, e.profile.angleReference]) {
      if (v != null) assert.ok(e.resistanceProfile.includes(v), `${e.id}: "${v}" is not in the source text`);
    }
  }
});

test('regions and actions stay separate entries with unique ids', () => {
  assert.equal(new Set(MUSCLE_ACTIONS.map((e) => e.id)).size, 34);
  assert.equal(MUSCLE_ACTIONS.filter((e) => e.muscleAction === 'Hip extension').length, 3);
  assert.equal(MUSCLE_ACTIONS.filter((e) => e.group === 'Hamstrings').length, 6);
  for (const e of MUSCLE_ACTIONS) assert.equal(`${e.group} — ${e.region}`, e.muscle);
});

test('entries carry no exercise data, and links start empty in their own store', () => {
  for (const e of MUSCLE_ACTIONS) {
    assert.deepEqual(Object.keys(e).sort(), ['group', 'id', 'muscle', 'muscleAction', 'order', 'profile', 'region', 'resistanceProfile', 'sourceRow']);
  }
  const s = memory();
  assert.deepEqual(loadLinks(s), {});
  assert.deepEqual(exercisesFor('latissimus-dorsi-upper', s), []);
  assert.equal(s._m.size, 0, 'reading must not create the store');
});

test('the link store is ready for later and rejects unknown entries', () => {
  const s = memory(), ids = new Set(MUSCLE_ACTIONS.map((e) => e.id));
  linkExercise('deltoid-middle', 'ex-1', ids, s);
  linkExercise('deltoid-middle', 'ex-1', ids, s); // no duplicates
  assert.deepEqual(exercisesFor('deltoid-middle', s), ['ex-1']);
  assert.throws(() => linkExercise('not-a-muscle', 'ex-1', ids, s), /Unknown/);
  unlinkExercise('deltoid-middle', 'ex-1', s);
  assert.deepEqual(JSON.parse(s.getItem(LINKS_KEY)), {});
  assert.ok(!MUSCLE_ACTIONS.some((e) => 'exercises' in e)); // entries untouched
});

test('the parser refuses wording it does not know instead of guessing', () => {
  assert.throws(() => parseProfile('ASCENDING-ish'), /Unrecognised/);
  assert.throws(() => parseProfile('ASCENDING; heaviest near lockout'), /Unrecognised/);
  assert.throws(() => parseSource('MUSCLE,PROFILE,ACTION\r\n'), /Unexpected header/);
  assert.throws(() => parseSource('MUSCLE,RESISTANCE PROFILE,MUSCLE ACTION\r\nDeltoid — Middle,,Abduction\r\n'), /not a complete entry/);
});
