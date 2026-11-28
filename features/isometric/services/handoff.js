// Isometric results into the workout logger, the same way the bar-speed camera hands back a set
// (features/velocity/services/workout.js): stable ids, never a set index or a name, and a capture token
// so an old camera tab can't overwrite a newer take.
import { isoModeFor } from './isometric.js';

export const ACTIVE_WORKOUT_KEY = 'jarvis_active_workout';
export const ISO_KEY = 'arete_isometric_sets';
const MAX_RECORDS = 300;

/** The camera page's address for this set; the caller saves the workout before going there. */
export function prepareIsoTracking(workout, exerciseId, setId, { captureId = `iso-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` } = {}) {
  const exercise = workout?.exercises?.find((e) => e.id === exerciseId);
  const set = exercise?.sets?.find((s) => s.id === setId);
  const mode = isoModeFor(exercise);
  if (!workout?.id || !set || !mode) throw new Error('This exercise has no isometric camera setup.');
  set.isoCaptureId = captureId;
  const params = new URLSearchParams({ mode, workout: workout.id, exercise: exerciseId, set: setId, capture: captureId, exerciseName: exercise.name });
  return `isometric.html?${params}`;
}

export function parseIsoContext(search = '') {
  const p = search instanceof URLSearchParams ? search : new URLSearchParams(search);
  const c = { workoutId: p.get('workout'), exerciseId: p.get('exercise'), setId: p.get('set'), captureId: p.get('capture') };
  return Object.values(c).every((v) => typeof v === 'string' && v.length > 0 && v.length <= 200) ? c : null;
}

/** Saved isometric records, oldest first. */
export function listIsoRecords(storage) {
  try { const v = JSON.parse(storage.getItem(ISO_KEY) || '[]'); return Array.isArray(v) ? v.filter((x) => x && x.id) : []; }
  catch { return []; }
}

/** Keep a record (replacing one with the same id), newest last, capped. */
export function saveIsoRecord(storage, record) {
  if (!record?.id) return false;
  const list = listIsoRecords(storage).filter((x) => x.id !== record.id);
  list.push(record);
  try { storage.setItem(ISO_KEY, JSON.stringify(list.slice(-MAX_RECORDS))); return true; }
  catch { return false; }
}

/**
 * Attach a finished set of pushes to the open workout's set. Nothing is written if the handoff fails.
 * A retake keeps the earlier take in isometricHistory; typed load is never touched.
 */
export function attachIsoSet(storage, context, record) {
  if (!context) return { ok: false, reason: 'No workout set was selected.' };
  if (!record?.id || !Array.isArray(record.pushes) || !record.pushes.length) return { ok: false, reason: 'There are no pushes to save.' };
  try {
    const workout = JSON.parse(storage.getItem(ACTIVE_WORKOUT_KEY) || 'null');
    if (workout?.id !== context.workoutId || workout.completedAt) return { ok: false, reason: 'The original workout is no longer open.' };
    const exercise = workout.exercises?.find((e) => e.id === context.exerciseId);
    const set = exercise?.sets?.find((s) => s.id === context.setId);
    if (!set) return { ok: false, reason: 'The original exercise or set was removed.' };
    const duplicate = set.isometric?.id === record.id && set.isometric.captureId === context.captureId;
    if (!duplicate && (!context.captureId || set.isoCaptureId !== context.captureId)) return { ok: false, reason: 'A newer tracking attempt was opened for this set.' };
    if (set.isometric && !duplicate) set.isometricHistory = [...(Array.isArray(set.isometricHistory) ? set.isometricHistory : []), set.isometric];
    set.isometric = { ...record, exercise: exercise.name, workoutId: workout.id, workoutExerciseId: exercise.id, setId: set.id, captureId: context.captureId, label: 'estimate' };
    set.reps = record.pushes.length;
    if (Number.isFinite(record.rpe) && record.rpe >= 1 && record.rpe <= 10) {
      set.reportedEffort = { ...(set.reportedEffort || {}), rpe: record.rpe, enteredAs: 'rpe', at: record.at || Date.now() };
      set.rpe = record.rpe;
    }
    delete set.isoCaptureId;
    storage.setItem(ACTIVE_WORKOUT_KEY, JSON.stringify(workout));
    return { ok: true, duplicate, workout, exercise, set };
  } catch {
    return { ok: false, reason: 'Workout storage is unavailable. Keep this result and try again.' };
  }
}

/** One line for the logger, e.g. "3 pushes · 6 s · elbow 92° · 1.3× your usual (estimate)". */
export function isoSummary(rec) {
  if (!rec || !Array.isArray(rec.pushes) || !rec.pushes.length) return '';
  const n = rec.pushes.length;
  const secs = rec.pushes.map((p) => p.durationSec).filter(Number.isFinite);
  const angles = rec.pushes.map((p) => p.angleDeg).filter(Number.isFinite);
  const label = { arms: 'elbow', legs: 'knee', hinge: 'hip' }[rec.mode] || 'angle';
  const parts = [`${n} push${n === 1 ? '' : 'es'}`];
  if (secs.length) parts.push(`${Math.round(secs.reduce((a, b) => a + b, 0) / secs.length)} s`);
  if (angles.length) parts.push(`${label} ${Math.round(angles.reduce((a, b) => a + b, 0) / angles.length)}°`);
  if (rec.vsUsual && Number.isFinite(rec.vsUsual.ratio)) parts.push(`${rec.vsUsual.ratio.toFixed(1)}× your usual shake (estimate)`);
  return parts.join(' · ');
}
