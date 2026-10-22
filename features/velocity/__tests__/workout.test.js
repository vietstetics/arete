import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSetRecord, buildLiveSetRecord, listSetRecords, saveSetRecord, SETS_KEY } from '../services/record.js';
import { ACTIVE_WORKOUT_KEY, trackerModeFor, prepareWorkoutTracking, parseWorkoutContext, attachTrackedSet, canonicalExerciseId, profileForRecord, gatherPredictionHistory, equipmentKeyFor } from '../services/workout.js';

const memory = () => {
  const data = new Map();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
};
const workout = () => ({ id: 'w-1', notes: 'keep notes', exercises: [
  { id: 'e-1', name: 'Bench Press', sets: [{ id: 's-1', type: 'working', weight: 80, rir: 2, rpe: 8, reps: 8, completed: false }, { id: 's-2', weight: 85, reps: 5 }] },
  { id: 'e-2', name: 'Bench Press', sets: [{ id: 's-3', weight: 60, reps: 10 }] },
] });
const reps = () => [
  { n: 1, isStandard: true, result: 'counted', bottom: 170, top: 45, vel: { mv: 0.5, pv: 0.8, dist: 0.5, T: 1, estimate: true } },
  { n: 2, result: 'short', vel: { mv: 1, pv: 2, dist: 0.2, T: 0.2 } },
  { n: 3, result: 'unclear', why: 'tracking lost', vel: { mv: 4 } },
  { n: 4, result: 'counted', bottom: 169, top: 46, vel: { mv: 0.4, pv: 0.6, dist: 0.48, T: 1.25 } },
];
const record = (id = 'take-1') => buildLiveSetRecord({ id, reps: reps(), standard: { start: 170, finish: 45, tol: 8 }, lift: 'bench', loadKg: 80, source: 'plate', scaled: true, calibration: { diameterM: 0.45, estimate: true }, at: 1000 });
function launch(storage, draft, eid = 'e-1', sid = 's-1', captureId = 'capture-1') {
  const url = prepareWorkoutTracking(draft, eid, sid, { captureId });
  storage.setItem(ACTIVE_WORKOUT_KEY, JSON.stringify(draft));
  return parseWorkoutContext(url.slice(url.indexOf('?')));
}

test('live records preserve ROM, timing, mean and peak but exclude short/unclear velocities', () => {
  const r = record();
  assert.equal(r.counted, 2);
  assert.equal(r.units, 'm/s');
  assert.equal(r.rep1, 0.5);
  assert.equal(r.lossPct, 23.2);
  assert.equal(r.D, 0.5);
  assert.equal(r.reps[0].peak, 0.8);
  assert.deepEqual(r.reps[0].rom, { start: 170, finish: 45 });
  assert.equal(r.reps[3].T, 1.25);
  assert.equal(r.reps[3].rel, 0.768);
  assert.equal(r.reps[3].standardRel, 0.8);
  for (const i of [1, 2]) {
    assert.equal(r.reps[i].velocity, 'none');
    assert.equal(r.reps[i].mcv, null);
    assert.equal(r.reps[i].peak, null);
  }
  assert.equal(r.reps[2].why, 'tracking lost');
  assert.equal(r.reps[0].estimate, true);
  assert.deepEqual(r.calibration, { diameterM: 0.45, estimate: true });
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r, 'record contains no NaN/undefined values that change during persistence');
});

test('relative records never infer physical units and missing original reference never migrates to a later rep', () => {
  const body = buildLiveSetRecord({ reps: reps(), id: 'relative' });
  assert.equal(body.units, 'relative');
  assert.equal(body.D, null);
  const missing = reps(); missing[0].vel = null;
  const r = buildLiveSetRecord({ reps: missing });
  assert.equal(r.rep1, null);
  assert.equal(r.lossPct, null);
  assert.ok(r.reps.every((x) => x.rel === null && x.loss === null));
  assert.ok(r.reps.filter((x) => x.result === 'counted').every((x) => x.velocity === 'unclear' && x.mcv === null));
  missing[0].velocityWhy = 'First rep was occluded';
  assert.equal(buildLiveSetRecord({ reps: missing }).reps[0].why, 'First rep was occluded');
  const none = buildLiveSetRecord({ reps: reps().map((x) => ({ ...x, isStandard: false })) });
  assert.equal(none.rep1, null);
});

test('validation lab relative history stores ratios, and preserves geometry estimates without relabeling native speed as m/s', () => {
  const analysis = { tracker: { id: 'plate3d', source: 'weight' }, scaled: false, rows: [
    { n: 1, result: 'counted', isStandard: true, velocity: 'ok', T: 1, mcv: 400, pv: 650, distance: 400, rel: 1, loss: 0, estimate: 'assumed intrinsics' },
    { n: 2, result: 'short', velocity: 'none', rel: NaN },
    { n: 3, result: 'counted', velocity: 'ok', T: 1.25, mcv: 320, rel: 0.8, loss: 0.2 },
  ] };
  const r = buildSetRecord(analysis);
  assert.equal(r.rep1, 1);
  assert.equal(r.last, 0.8);
  assert.equal(r.lossPct, 20);
  assert.equal(r.reps[0].mcv, null);
  assert.equal(r.reps[0].nativeMcv, 400);
  assert.equal(r.reps[0].distance, null);
  assert.equal(r.reps[0].estimate, 'assumed intrinsics');
  analysis.rows[0].velocity = 'unclear';
  const unclear = buildSetRecord(analysis);
  assert.equal(unclear.rep1, null);
  assert.equal(unclear.lossPct, null);
});

test('live velocity scale changes distance and speed but leaves seconds and ratios unchanged', () => {
  const r = buildLiveSetRecord({ reps: reps(), velocityScale: 2, scaled: true });
  assert.equal(r.rep1, 1);
  assert.equal(r.D, 1);
  assert.equal(r.reps[0].peak, 1.6);
  assert.equal(r.reps[0].T, 1);
  assert.equal(r.reps[3].rel, 0.768);
});

test('camera setup is exercise specific and unknown exercises never silently become curls', () => {
  for (const [name, mode] of [['Back Squat', 'squat'], ['Dumbbell Bench Press', 'bench'], ['Chest Press', 'press'], ['Seated Cable Row', 'row'], ['Dumbbell Curl', 'curl'], ['Pull-up', 'pullup']]) assert.equal(trackerModeFor({ name }), mode, name);
  for (const name of ['Leg Curl', 'Deadlift', 'Unknown exercise', 'Overhead Press']) assert.equal(trackerModeFor({ name }), null, name);
  assert.equal(parseWorkoutContext('?ex=curl&workout=1&exercise=2&set=3'), null);
});

test('handoff uses persisted workout/exercise/set IDs despite duplicate names and reordered sets', () => {
  const storage = memory(), draft = workout();
  const context = launch(storage, draft);
  draft.exercises[0].sets.reverse();
  storage.setItem(ACTIVE_WORKOUT_KEY, JSON.stringify(draft));
  const result = attachTrackedSet(storage, context, record());
  assert.equal(result.ok, true);
  const saved = JSON.parse(storage.getItem(ACTIVE_WORKOUT_KEY));
  assert.equal(saved.exercises[0].sets[1].velocity.id, 'take-1');
  assert.equal(saved.exercises[0].sets[1].reps, 2);
  assert.equal(saved.exercises[0].sets[1].weight, 80);
  assert.equal(saved.exercises[0].sets[1].rir, 2);
  assert.equal(saved.exercises[0].sets[1].velocity.typedRir, 2);
  assert.equal(saved.exercises[0].sets[1].completed, false, 'lifter still reviews and completes the set');
  assert.deepEqual(saved.exercises[1], draft.exercises[1]);
  assert.deepEqual(saved.exercises[0].sets[0], draft.exercises[0].sets[0]);
  assert.equal(saved.notes, draft.notes);
});

test('stale, deleted, completed and newer-capture destinations fail without any write', () => {
  for (const change of [
    (w) => { w.id = 'different'; },
    (w) => { w.exercises = []; },
    (w) => { w.exercises[0].sets.shift(); },
    (w) => { w.completedAt = 123; },
    (w) => { w.exercises[0].sets[0].velocityCaptureId = 'newer'; },
  ]) {
    const storage = memory(), draft = workout(), context = launch(storage, draft);
    change(draft); storage.setItem(ACTIVE_WORKOUT_KEY, JSON.stringify(draft));
    const before = storage.getItem(ACTIVE_WORKOUT_KEY);
    assert.equal(attachTrackedSet(storage, context, record()).ok, false);
    assert.equal(storage.getItem(ACTIVE_WORKOUT_KEY), before);
  }
});

test('review edits update same record once, and a new take retains its predecessor', () => {
  const storage = memory(); let draft = workout();
  const context = launch(storage, draft);
  assert.equal(attachTrackedSet(storage, context, record()).ok, true);
  const edited = record(); edited.reps[1].result = 'counted'; edited.counted = 3;
  assert.equal(attachTrackedSet(storage, context, edited).duplicate, true);
  draft = JSON.parse(storage.getItem(ACTIVE_WORKOUT_KEY));
  assert.equal(draft.exercises[0].sets[0].reps, 3);
  assert.equal(draft.exercises[0].sets[0].velocityHistory, undefined);
  const next = launch(storage, draft, 'e-1', 's-1', 'capture-2');
  assert.equal(attachTrackedSet(storage, context, edited).ok, false, 'old tab cannot edit after another take opens');
  assert.equal(attachTrackedSet(storage, next, record('take-2')).ok, true);
  draft = JSON.parse(storage.getItem(ACTIVE_WORKOUT_KEY));
  assert.deepEqual(draft.exercises[0].sets[0].velocityHistory.map((x) => x.id), ['take-1']);
});

test('launch carries exercise source, load and typed RIR with encoded names', () => {
  const draft = workout(); draft.exercises[0].name = 'Chest Press';
  const url = prepareWorkoutTracking(draft, 'e-1', 's-1', { captureId: 'abc' });
  const params = new URLSearchParams(url.split('?')[1]);
  assert.equal(params.get('velocitySource'), 'hand');
  assert.equal(params.get('loadKg'), '80');
  assert.equal(params.get('typedRir'), '2');
  assert.equal(params.get('exerciseName'), 'Chest Press');
  assert.equal(params.get('ex'), 'press');
  draft.exercises[0].sets[0].reportedEffort={rir:null,rpe:9,enteredAs:'rpe'};
  const explicit=new URLSearchParams(prepareWorkoutTracking(draft,'e-1','s-1').split('?')[1]);
  assert.equal(explicit.get('reportsExplicit'),'1');
  assert.equal(explicit.has('reportedRir'),false,'converted scalar RIR is never promoted to an actual RIR report');
  assert.equal(explicit.get('reportedRpe'),'9');
  assert.equal(explicit.get('effortSource'),'rpe');
});

test('camera effort only replaces logger effort after an explicit edit, including clearing it', () => {
  const storage = memory(), context = launch(storage, workout());
  const take = { ...record(), typedRir: 3,reportedEffort:{rir:3,rpe:null,enteredAs:'rir',at:1000} };
  assert.equal(attachTrackedSet(storage, context, take).set.rir, 2, 'initial camera result preserves logger effort');
  const changed = attachTrackedSet(storage, context, take, { updateTypedRir: true });
  assert.equal(changed.set.rir, 3);
  assert.equal(changed.set.rpe, 7);
  assert.equal(changed.set.velocity.typedRir, 3);
  const cleared = attachTrackedSet(storage, context, { ...take, typedRir: null,reportedEffort:{rir:null,rpe:null,enteredAs:'rir',at:1001} }, { updateTypedRir: true });
  assert.equal(cleared.set.rir, '');
  assert.equal(cleared.set.rpe, '');
  assert.equal(cleared.set.velocity.typedRir, null);
  const independent=attachTrackedSet(storage,context,{...take,reportedEffort:{rir:3,rpe:9,enteredAs:'rpe',at:1002}},{updateTypedRir:true});
  assert.equal(independent.set.rir,3);
  assert.equal(independent.set.rpe,9,'actual reported RPE is not overwritten by a conversion');
});

test('unavailable/corrupt storage gives a failed handoff and standalone history can recover malformed shape', () => {
  assert.equal(attachTrackedSet({ getItem() { throw new Error('denied'); } }, { workoutId: 'w' }, record()).ok, false);
  const storage = memory(); storage.setItem(SETS_KEY, '{}');
  assert.deepEqual(listSetRecords(storage), []);
  saveSetRecord(storage, record());
  assert.equal(listSetRecords(storage).length, 1);
  saveSetRecord(storage, { ...record(), typedRir: 3 });
  assert.equal(listSetRecords(storage).length, 1, 'reviewing the same take does not duplicate history');
  assert.equal(listSetRecords(storage)[0].typedRir, 3);
});

test('coach export keeps attached rep data and retake history through JSON export/import', () => {
  const storage = memory(), context = launch(storage, workout());
  attachTrackedSet(storage, context, record());
  const saved = JSON.parse(storage.getItem(ACTIVE_WORKOUT_KEY));
  saved.completedAt = Date.now();
  saved.exercises[0].sets[0].velocityHistory = [record('earlier')];
  const html = readFileSync(new URL('../../../workouts.html', import.meta.url), 'utf8');
  const body = html.match(/function buildClientExport\(\)\{([\s\S]*?)\n\}/)[1];
  const buildExport = new Function('completed', 'myName', 'getPrograms', body);
  const exported = JSON.parse(JSON.stringify(buildExport(() => [saved], () => 'Athlete', () => [])));
  const set = exported.workouts[0].exercises[0].sets[0];
  assert.deepEqual(set.velocity, saved.exercises[0].sets[0].velocity);
  assert.equal(set.velocityHistory[0].id, 'earlier');
  assert.equal(set.rir, 2);
});

test('prediction profiles retain stable exercise, user and exact equipment identities across sessions', () => {
  const base={...record(),metric:'mean-concentric-velocity',exercise:'  Bench   Press ',userId:'ATHLETE@example.invalid',equipmentKey:'Barbell · flat bench',rirEndpoint:'technical'};
  const profile=profileForRecord(base);
  assert.equal(profile.exerciseId,'bench press');
  assert.equal(profile.userId,'athlete@example.invalid');
  assert.equal(profile.equipmentId,'barbell · flat bench');
  assert.equal(canonicalExerciseId(' Bench Press '),'bench press');
  assert.equal(profileForRecord({...base,equipmentKey:null}),null,'unknown equipment never borrows the current variation');
  assert.equal(profileForRecord({...base,metric:null}),null,'legacy velocity convention must be explicit');
  assert.notEqual(equipmentKeyFor({machine:{id:'press-1',mode:'independent'}}),equipmentKeyFor({machine:{id:'press-1',mode:'bilateral'}}));
});

test('prediction history merges records without inventing past athlete identity and prefers updated workout reports', () => {
  const storage=memory(),draft=workout(); draft.userId='athlete@example.invalid'; draft.exercises[0].equipmentKey='Barbell';
  const context=launch(storage,draft);
  const take={...record(),metric:'mean-concentric-velocity',userId:draft.userId};
  saveSetRecord(storage,take);
  attachTrackedSet(storage,context,take);
  const stored=JSON.parse(storage.getItem(ACTIVE_WORKOUT_KEY));
  stored.exercises[0].sets[0].reportedEffort={rir:1,rpe:9,enteredAs:'rir',at:2000};
  stored.exercises[0].sets[0].failureEndpoint={verified:true,type:'technical',at:2000};
  storage.setItem(ACTIVE_WORKOUT_KEY,JSON.stringify(stored));
  const history=gatherPredictionHistory(storage);
  assert.equal(history.length,1);
  assert.equal(history[0].reportedEffort.rir,1);
  assert.equal(history[0].sessionId,'w-1');
  assert.equal(history[0].exerciseId,'bench press');
  assert.equal(history[0].equipmentKey,'barbell');
  assert.equal(history[0].failureEndpoint.type,'technical');
  const anonymous={...record('anonymous'),userId:null};saveSetRecord(storage,anonymous);
  assert.equal(gatherPredictionHistory(storage).find(r=>r.id==='anonymous').userId,null);
});

test('new camera take never assumes a previously verified failure or successful maximum occurred again',()=>{
  const draft=workout(),set=draft.exercises[0].sets[0];
  set.failureEndpoint={verified:true,type:'technical'};set.tested1RM={verified:true,loadKg:80};
  prepareWorkoutTracking(draft,'e-1','s-1');
  assert.equal(set.failureEndpoint,null);assert.equal(set.tested1RM,null);
});
