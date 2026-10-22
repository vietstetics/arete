// Workout handoff uses stable IDs, never a set index or an exercise name.
// A capture token also prevents an old camera tab overwriting a newer take.
import { velocitySourceFor } from './sources.js';

export const ACTIVE_WORKOUT_KEY = 'jarvis_active_workout';

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
export function prepareWorkoutTracking(workout, exerciseId, setId, { captureId = `capture-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` } = {}) {
  const exercise = workout?.exercises?.find((e) => e.id === exerciseId);
  const set = exercise?.sets?.find((s) => s.id === setId);
  const mode = trackerModeFor(exercise);
  if (!workout?.id || !set || !mode) throw new Error('This exercise has no supported camera setup.');
  set.velocityCaptureId = captureId;
  const params = new URLSearchParams({ ex: mode, workout: workout.id, exercise: exerciseId, set: setId, capture: captureId });
  params.set('exerciseName', exercise.name);
  const velocitySource = velocitySourceFor({ ...exercise, equipment: exercise.machine ? 'Machine' : exercise.equipment });
  if (velocitySource) params.set('velocitySource', velocitySource);
  if (set.weight !== '' && set.weight != null && Number.isFinite(+set.weight)) params.set('loadKg', String(+set.weight));
  if (set.rir !== '' && set.rir != null && Number.isFinite(+set.rir)) params.set('typedRir', String(+set.rir));
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
    }
    set.velocity = { ...record, exercise: exercise.name, workoutId: workout.id, exerciseId: exercise.id, setId: set.id, captureId: context.captureId,
      typedRir: set.rir !== '' && set.rir != null && Number.isFinite(+set.rir) ? +set.rir : record.typedRir };
    set.reps = record.counted;
    delete set.velocityCaptureId;
    storage.setItem(ACTIVE_WORKOUT_KEY, JSON.stringify(workout));
    return { ok: true, duplicate, workout, exercise, set };
  } catch {
    return { ok: false, reason: 'Workout storage is unavailable. Keep this result and try again.' };
  }
}
