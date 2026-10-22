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
  if (/^(?:pull[ -]?ups?|chin[ -]?ups?)$/.test(name)) return 'pullup';
  if (/\bcurl\b/.test(name) && !/\bleg\b/.test(name)) return 'curl';
  if (/^(?:machine )?chest press$/.test(name)) return 'press';
  if (/^(?:seated )?cable row$|^(?:seated )?machine row$|^t[ -]?bar row$/.test(name)) return 'row';
  return null;
}

export function parseWorkoutContext(search = '') {
  const params = search instanceof URLSearchParams ? search : new URLSearchParams(search);
  const context = { workoutId: params.get('workout'), exerciseId: params.get('exercise'), setId: params.get('set'), captureId: params.get('capture') };
  return Object.values(context).every((v) => typeof v === 'string' && v.length > 0 && v.length <= 200) ? context : null;
}

/** Prepare a launch; caller saves workout before navigating to the returned URL. */
export function prepareWorkoutTracking(workout, exerciseId, setId, { captureId = `capture-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, userId } = {}) {
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
    set.velocity = { ...record, exercise: exercise.name, workoutId: workout.id, exerciseId: canonicalExerciseId(exercise.name), workoutExerciseId: exercise.id, setId: set.id, captureId: context.captureId,
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
    storage.setItem(ACTIVE_WORKOUT_KEY, JSON.stringify(workout));
    return { ok: true, duplicate, workout, exercise, set };
  } catch {
    return { ok: false, reason: 'Workout storage is unavailable. Keep this result and try again.' };
  }
}
