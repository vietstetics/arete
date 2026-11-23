// Workout handoff uses stable IDs, never a set index or an exercise name.
// A capture token also prevents an old camera tab overwriting a newer take.
import { velocitySourceFor } from './sources.js';
import { listSetRecords } from './record.js';

export const ACTIVE_WORKOUT_KEY = 'jarvis_active_workout';

const identity = (value) => typeof value === 'string' && value.trim() ? value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase() : null;
export const canonicalExerciseId = identity;
export function equipmentKeyFor(exercise = {}) {
  if (exercise.equipmentKey) return identity(exercise.equipmentKey);
  const machine = exercise.machine?.snapshot || exercise.machine;
  return machine?.id ? `machine:${machine.id}:${machine.mode || 'default'}` : null;
}
export function predictionContextFor(workout, exercise, { userId } = {}) {
  return { userId: identity(userId || workout?.userId), exerciseId: canonicalExerciseId(exercise?.name), equipmentKey: equipmentKeyFor(exercise) };
}
/** Missing identity and metric metadata are intentionally not filled from another set. */
export function profileForRecord(record = {}, { exerciseName, equipmentId, userId } = {}) {
  const profile = {
    userId: identity(userId || record.userId || record.profile?.userId),
    exerciseId: canonicalExerciseId(exerciseName || record.exercise || record.profile?.exerciseId),
    equipmentId: identity(equipmentId || record.equipmentKey || record.equipmentId || record.profile?.equipmentId),
    source: record.source || record.profile?.source,
    units: record.units || record.profile?.units,
    metric: record.metric || record.profile?.metric,
    endpoint: record.rirEndpoint || record.failureEndpoint?.type || record.profile?.endpoint || 'unspecified',
  };
  return ['userId','exerciseId','equipmentId','source','units','metric'].every((k) => typeof profile[k] === 'string' && profile[k]) ? profile : null;
}
/** Local records retain their original session and athlete; workout copies win over an older standalone copy. */
export function gatherPredictionHistory(storage) {
  const records = new Map(); let anonymous = 0;
  const add = (record) => {
    if (!record || !Array.isArray(record.reps)) return;
    records.set(record.id || `legacy-${anonymous++}`, { ...record });
  };
  listSetRecords(storage).forEach(add);
  let workouts = [], active = null;
  try { const value = JSON.parse(storage.getItem('jarvis_workouts') || '[]'); if (Array.isArray(value)) workouts = value; } catch {}
  try { active = JSON.parse(storage.getItem(ACTIVE_WORKOUT_KEY) || 'null'); } catch {}
  [...workouts, ...(active ? [active] : [])].forEach((workout) => (workout.exercises || []).forEach((exercise) => (exercise.sets || []).forEach((set) => {
    if (!set.velocity) return;
    const record = { ...set.velocity,
      userId: set.velocity.userId || workout.userId || null,
      exercise: exercise.name, exerciseId: canonicalExerciseId(exercise.name),
      equipmentKey: set.velocity.equipmentKey || equipmentKeyFor(exercise),
      sessionId: set.velocity.sessionId || workout.id,
      reportedEffort: set.reportedEffort || set.velocity.reportedEffort || null,
      failureEndpoint: set.failureEndpoint || set.velocity.failureEndpoint || null,
      rirEndpoint: set.rirEndpoint || set.velocity.rirEndpoint || null,
      tested1RM: set.tested1RM || set.velocity.tested1RM || null,
      maximalIntent: set.maximalIntent ?? set.velocity.maximalIntent ?? false,
      ...(Number.isFinite(set.restSec) ? { restSec: set.restSec, restMethod:set.restMethod||null } : {}),
    };
    record.profile = profileForRecord(record);
    add(record);
  })));
  return [...records.values()].sort((a,b) => (a.at || 0) - (b.at || 0));
}

/** Supported pose setups only; unknown lifts must not silently become curls. */
export function trackerModeFor(exercise = {}) {
  const name = String(exercise.name || '').trim().toLowerCase();
  if (/^(?:barbell |back |front |goblet )?squat$/.test(name)) return 'squat';
  if (/^(?:barbell |dumbbell |incline |decline |flat )*bench press$/.test(name)) return 'bench';
  if (/^(?:barbell |conventional |sumo )?deadlift$/.test(name)) return 'deadlift';
  if (/^(?:weighted |assisted )?(?:pull[ -]?ups?|chin[ -]?ups?)$/.test(name)) return 'pullUp';
  // Curls of the wrist or fingers, and the Nordic curl (knees, body falling forward), aren't the elbow's
  // curl: no tracker until one is built and checked on footage.
  if (/\b(?:wrist|finger|nordic)\b/.test(name)) return null;
  if (/\b(?:leg|hamstring) curls?$/.test(name)) return 'legCurl';
  if (/\bcurl\b/.test(name) && !/\bleg\b/.test(name)) return 'curl';
  if (/^(?:flat |incline |decline |converging |close[ -]grip |seated )*(?:machine (?:chest )?|chest )press$/.test(name)) return 'press';
  if (/^(?:dumbbell |cable |seated |machine )?lateral raises?$/.test(name)) return 'lateral';
  // Rows are read from the hand's reach in 3D, whatever the torso's angle (bent over or chest-supported).
  if (/^(?:seated )?cable row$|^(?:seated )?machine row$|^t[ -]?bar row$|^(?:barbell |bent[ -]over )+row$|^high row$|^(?:wide )?chest[ -]supported (?:upper[ -]back )?row$|^one[ -]arm lat[ -]focused row$/.test(name)) return 'row';
  if (/\btriceps? (?:push[ -]?downs?|extensions?|kick[ -]?backs?)$|\bskull ?crushers?$|^(?:cable |rope )?push[ -]?downs?$/.test(name)) return 'triceps';
  if (/^(?:full[ -]rom |top[ -]half |dumbbell |barbell |machine |seated |standing )*(?:overhead|shoulder|military) press$/.test(name)) return 'shoulderPress';
  if (/^(?:lat |wide[ -]grip |close[ -]grip |medium[ -]grip |neutral[ -]grip |single[ -]arm |cable )*pull[ -]?downs?$/.test(name)) return 'pulldown';
  if (/^(?:bar |parallel bar |weighted |assisted |machine |chest[ -]biased |chest |triceps? )*dips?$/.test(name)) return 'dip';
  if (/^(?:pec deck|(?:machine |cable |dumbbell |chest )*fl(?:y|ies|yes))$/.test(name)) return 'fly';
  if (/^(?:machine |seated |reclined )?leg extensions?$/.test(name)) return 'legExtension';
  if (/^(?:standing |seated |machine |smith machine )*calf raises?$/.test(name)) return 'calfRaise';
  if (/^(?:machine |plate[ -]loaded |pendulum )?hack squats?$|^(?:machine |seated |45[ -]degree |horizontal )?leg press(?:es)?$|^belt squats?$|^(?:machine |pendulum |smith machine )squats?$/.test(name)) return 'hackSquat';
  if (/^(?:45[ -]degree |90[ -]degree |roman chair |weighted )?(?:back extensions?|hyperextensions?)$/.test(name)) return 'backExtension';
  if (/^(?:barbell |machine |smith machine |single[ -]leg )?(?:hip thrusts?|glute bridges?)$/.test(name)) return 'hipThrust';
  if (/^(?:machine |seated |cable )*hip abductions?(?: machine)?$|^(?:machine |seated )*(?:thigh |outer thigh )abductions?$/.test(name)) return 'hipAbduction';
  if (/^(?:machine |seated |cable )*hip adductions?(?: machine)?$|^cable adductions?$|^(?:machine |seated )*(?:thigh |inner thigh )adductions?$/.test(name)) return 'hipAdduction';
  return null;
}

export function parseWorkoutContext(search = '') {
  const params = search instanceof URLSearchParams ? search : new URLSearchParams(search);
  const context = { workoutId: params.get('workout'), exerciseId: params.get('exercise'), setId: params.get('set'), captureId: params.get('capture') };
  return Object.values(context).every((v) => typeof v === 'string' && v.length > 0 && v.length <= 200) ? context : null;
}

/** Prepare a launch; caller saves workout before navigating to the returned URL. */
export function prepareWorkoutTracking(workout, exerciseId, setId, { captureId = `capture-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, userId, chain = false } = {}) {
  const exercise = workout?.exercises?.find((e) => e.id === exerciseId);
  const set = exercise?.sets?.find((s) => s.id === setId);
  const mode = trackerModeFor(exercise);
  if (!workout?.id || !set || !mode) throw new Error('This exercise has no supported camera setup.');
  set.velocityCaptureId = captureId;
  // Reaching an endpoint and succeeding at a maximum describe a completed
  // attempt; neither can be assumed for a newly recorded take.
  set.failureEndpoint = null;
  set.tested1RM = null;
  const params = new URLSearchParams({ ex: mode, workout: workout.id, exercise: exerciseId, set: setId, capture: captureId });
  if (chain) { exercise.velocityChainId = captureId; delete exercise.velocityChainNextKg; params.set('chain', captureId); }
  params.set('exerciseName', exercise.name);
  const context = predictionContextFor(workout, exercise, { userId });
  if (context.userId) { params.set('userId', context.userId); workout.userId = context.userId; }
  if (context.equipmentKey) params.set('equipmentKey', context.equipmentKey);
  params.set('sessionId', workout.id);
  if (set.rirEndpoint) params.set('rirEndpoint', set.rirEndpoint);
  if (set.maximalIntent === true) params.set('maximalIntent', '1');
  if (Number.isFinite(set.restSec)) { params.set('restSec', String(set.restSec)); if(set.restMethod) params.set('restMethod',set.restMethod); }
  const velocitySource = velocitySourceFor({ ...exercise, equipment: exercise.machine ? 'Machine' : exercise.equipment });
  if (velocitySource) params.set('velocitySource', velocitySource);
  if (set.weight !== '' && set.weight != null && Number.isFinite(+set.weight)) params.set('loadKg', String(+set.weight));
  if (set.rir !== '' && set.rir != null && Number.isFinite(+set.rir)) params.set('typedRir', String(+set.rir));
  if (set.reportedEffort) {
    params.set('reportsExplicit','1');
    if (Number.isFinite(set.reportedEffort.rir)) params.set('reportedRir',String(set.reportedEffort.rir));
    if (Number.isFinite(set.reportedEffort.rpe)) params.set('reportedRpe',String(set.reportedEffort.rpe));
    if (set.reportedEffort.enteredAs) params.set('effortSource',set.reportedEffort.enteredAs);
  }
  return `curl-lab.html?${params}`;
}

// Writes a finished take into a set. Retakes keep earlier measurements; typed load is never replaced.
function fillSet(workout, exercise, set, record, captureId, { duplicate = false, updateTypedRir = false } = {}) {
  if (set.velocity && !duplicate) set.velocityHistory = [...(Array.isArray(set.velocityHistory) ? set.velocityHistory : []), set.velocity];
  if (updateTypedRir) {
    const rir = record.typedRir;
    if (rir === null) { set.rir = ''; set.rpe = ''; }
    else if (Number.isFinite(rir) && rir >= 0 && rir <= 10) { set.rir = rir; set.rpe = 10 - rir; }
    if (record.reportedEffort) set.reportedEffort = record.reportedEffort;
    if (record.reportedEffort) {
      const effort = record.reportedEffort;
      set.rir = Number.isFinite(effort.rir) ? effort.rir : Number.isFinite(effort.rpe) ? 10 - effort.rpe : '';
      set.rpe = Number.isFinite(effort.rpe) ? effort.rpe : Number.isFinite(effort.rir) ? 10 - effort.rir : '';
    }
    for (const field of ['failureEndpoint','tested1RM','rirEndpoint','maximalIntent','epleySupported']) {
      if (Object.hasOwn(record,field)) set[field] = record[field];
    }
  }
  set.velocity = { ...record, exercise: exercise.name, workoutId: workout.id, exerciseId: canonicalExerciseId(exercise.name), workoutExerciseId: exercise.id, setId: set.id, captureId,
    userId: record.userId || workout.userId || null, equipmentKey: record.equipmentKey || equipmentKeyFor(exercise), sessionId: workout.id,
    reportedEffort: set.reportedEffort || record.reportedEffort || null,
    failureEndpoint: set.failureEndpoint || record.failureEndpoint || null,
    rirEndpoint: set.rirEndpoint || record.rirEndpoint || null,
    tested1RM: set.tested1RM || record.tested1RM || null,
    maximalIntent: set.maximalIntent ?? record.maximalIntent ?? false,
    typedRir: set.rir !== '' && set.rir != null && Number.isFinite(+set.rir) ? +set.rir : record.typedRir };
  set.velocity.profile = profileForRecord(set.velocity);
  if (record.predictions) set.predictions = record.predictions;
  if (record.evaluation || record.predictionEvaluation) set.evaluation = record.evaluation || record.predictionEvaluation;
  set.reps = record.counted;
  delete set.velocityCaptureId;
}

/**
 * Attach a finished take to the current stored draft. A failed handoff never
 * writes anything; the camera can still keep the standalone velocity record.
 * Retakes retain earlier measurements and never replace typed effort or load.
 */
export function attachTrackedSet(storage, context, record, { updateTypedRir = false } = {}) {
  if (!context) return { ok: false, reason: 'No workout set was selected.' };
  if (!record?.id || !Array.isArray(record.reps) || !record.reps.length || !Number.isInteger(record.counted) || record.counted < 0) return { ok: false, reason: 'There are no completed reps to save.' };
  try {
    const workout = JSON.parse(storage.getItem(ACTIVE_WORKOUT_KEY) || 'null');
    if (workout?.id !== context.workoutId || workout.completedAt) return { ok: false, reason: 'The original workout is no longer open.' };
    const exercise = workout.exercises?.find((e) => e.id === context.exerciseId);
    const set = exercise?.sets?.find((s) => s.id === context.setId);
    if (!set) return { ok: false, reason: 'The original exercise or set was removed.' };
    const duplicate = set.velocity?.id === record.id && set.velocity.captureId === context.captureId;
    if (!duplicate && (!context.captureId || set.velocityCaptureId !== context.captureId)) return { ok: false, reason: 'A newer tracking attempt was opened for this set.' };
    if (duplicate && set.velocityCaptureId && set.velocityCaptureId !== context.captureId) return { ok: false, reason: 'A newer tracking attempt was opened for this set.' };
    fillSet(workout, exercise, set, record, context.captureId, { duplicate, updateTypedRir });
    storage.setItem(ACTIVE_WORKOUT_KEY, JSON.stringify(workout));
    return { ok: true, duplicate, workout, exercise, set };
  } catch {
    return { ok: false, reason: 'Workout storage is unavailable. Keep this result and try again.' };
  }
}

// ── Chain mode: one camera session fills every set of an exercise ──
function chainOpen(storage, context) {
  if (!context?.chainId) return { ok: false, reason: 'No camera session was selected.' };
  const workout = JSON.parse(storage.getItem(ACTIVE_WORKOUT_KEY) || 'null');
  if (workout?.id !== context.workoutId || workout.completedAt) return { ok: false, reason: 'The original workout is no longer open.' };
  const exercise = workout.exercises?.find((e) => e.id === context.exerciseId);
  if (!exercise || !Array.isArray(exercise.sets)) return { ok: false, reason: 'The original exercise was removed.' };
  if (exercise.velocityChainId !== context.chainId) return { ok: false, reason: 'A newer camera session was opened for this exercise.' };
  return { ok: true, workout, exercise };
}
// The set the next take goes into: the first open set from the one the camera was opened on.
function chainTarget(exercise, context) {
  const from = Math.max(0, exercise.sets.findIndex((s) => s.id === context.setId));
  const i = exercise.sets.findIndex((s, j) => j >= from && !s.velocity && !s.completed);
  return i >= 0 ? { set: exercise.sets[i], n: i + 1 } : null;
}
function newChainSet(exercise) {
  const last = exercise.sets[exercise.sets.length - 1] || {};
  const weight = Number.isFinite(exercise.velocityChainNextKg) ? exercise.velocityChainNextKg : last.weight ?? '';
  return { id: `s-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, type: last.type || 'working', weight,
    ...(exercise.unilateral ? { weightL: last.weightL ?? '', weightR: last.weightR ?? '' } : {}), unit: last.unit || 'kg', reps: '', completed: false };
}

/** Next set number and weight, for the camera's rest screen. */
export function peekChainTarget(storage, context) {
  try {
    const o = chainOpen(storage, context); if (!o.ok) return o;
    const t = chainTarget(o.exercise, context);
    const weight = t ? t.set.weight : Number.isFinite(o.exercise.velocityChainNextKg) ? o.exercise.velocityChainNextKg : o.exercise.sets.at(-1)?.weight ?? '';
    return { ok: true, n: t ? t.n : o.exercise.sets.length + 1, weight: weight === '' || weight == null ? null : +weight, added: !t };
  } catch { return { ok: false, reason: 'Workout storage is unavailable.' }; }
}

/** The lifter changed the weight for the next set on the rest screen. */
export function setChainTargetWeight(storage, context, kg) {
  try {
    const o = chainOpen(storage, context); if (!o.ok) return o;
    const v = Number.isFinite(kg) && kg >= 0 ? kg : '';
    const t = chainTarget(o.exercise, context);
    if (t) { t.set.weight = v; if (t.set.velocity) t.set.velocity.loadKg = v === '' ? null : v; }
    else o.exercise.velocityChainNextKg = v === '' ? null : v;
    storage.setItem(ACTIVE_WORKOUT_KEY, JSON.stringify(o.workout));
    return { ok: true };
  } catch { return { ok: false, reason: 'Workout storage is unavailable.' }; }
}

/**
 * Attach one chained set: the same take again updates its set; a new take fills the next open set, or a
 * new set when the planned ones are used up. The set is ticked off; the logger runs the PR check
 * (chainTicked) when you return.
 */
export function attachChainedSet(storage, context, record, { endedAt = Date.now(), restSec, updateTypedRir = false } = {}) {
  if (!record?.id || !Array.isArray(record.reps) || !record.reps.length || !Number.isInteger(record.counted) || record.counted < 0) return { ok: false, reason: 'There are no completed reps to save.' };
  try {
    const o = chainOpen(storage, context); if (!o.ok) return o;
    const { workout, exercise } = o;
    let set = exercise.sets.find((s) => s.velocity?.id === record.id);
    const duplicate = !!set;
    if (!set) {
      set = chainTarget(exercise, context)?.set;
      if (!set) { set = newChainSet(exercise); exercise.sets.push(set); delete exercise.velocityChainNextKg; }
    }
    if ((set.weight === '' || set.weight == null) && Number.isFinite(record.loadKg)) set.weight = record.loadKg;
    fillSet(workout, exercise, set, record, context.chainId, { duplicate, updateTypedRir });
    if (!duplicate) {
      set.completed = true; set.completedAt = endedAt; set.chainTicked = true;
      if (Number.isFinite(restSec) && restSec >= 0) { set.restSec = restSec; set.restMethod = 'camera-chain'; }
    }
    storage.setItem(ACTIVE_WORKOUT_KEY, JSON.stringify(workout));
    return { ok: true, duplicate, workout, exercise, set, n: exercise.sets.indexOf(set) + 1 };
  } catch {
    return { ok: false, reason: 'Workout storage is unavailable. Keep this result and try again.' };
  }
}
