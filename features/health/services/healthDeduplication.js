// Deduplication rules.
//  1. Identity: sourceProvider + sourceRecordId is unique — enforced by the
//     repository at insert time.
//  2. Overlapping workouts across sources: compare activity type, start time,
//     end time and duration; when an imported workout matches one the user
//     logged directly in Arete, PREFER ARETE's record. The imported copy is
//     kept for audit but flagged duplicateOf and excluded from totals.

const START_TOLERANCE_MS = 10 * 60 * 1000;  // starts within 10 min
const DURATION_TOLERANCE = 0.25;            // durations within 25%

function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z]/g, ''); }

/** True when an imported workout record duplicates an Arete-logged workout. */
export function workoutsOverlap(imported, areteWorkout) {
  const impStart = Date.parse(imported.startTime);
  const impEnd = imported.endTime ? Date.parse(imported.endTime) : impStart + (imported.value || 0) * 60000;
  const aStart = areteWorkout.startedAt || areteWorkout.completedAt;
  const aEnd = areteWorkout.completedAt || aStart;
  if (!isFinite(impStart) || !aStart) return false;

  if (Math.abs(impStart - aStart) > START_TOLERANCE_MS) {
    // also treat containment as overlap (watch auto-detects a longer session)
    const contained = impStart <= aStart && impEnd >= aEnd;
    if (!contained) return false;
  }
  const impDur = Math.max(1, (impEnd - impStart) / 60000);
  const aDur = Math.max(1, (aEnd - aStart) / 60000);
  const ratio = Math.abs(impDur - aDur) / Math.max(impDur, aDur);
  if (ratio > DURATION_TOLERANCE && !(impStart <= aStart && impEnd >= aEnd)) return false;

  // activity type: watches log gym work as "Strength Training"/"HIIT"/"Workout",
  // which must match ANY Arete-logged session ("Push Day"). Only clearly-cardio
  // types conflict — unless the Arete name itself mentions that cardio.
  const CARDIO = ['running', 'walking', 'cycling', 'swimming', 'rowing', 'hiking', 'elliptical', 'football', 'basketball', 'yoga'];
  const it = norm(imported.meta && imported.meta.activityType);
  if (it && CARDIO.includes(it) && !norm(areteWorkout.name).includes(it)) {
    return false; // e.g. auto-detected "Running" vs a logged "Push Day"
  }
  return true;
}

/**
 * Flags imported workout records that duplicate Arete's own logged workouts.
 * Returns the ids flagged. Arete's record always wins.
 */
export function dedupeWorkouts(importedWorkoutRecords, areteWorkouts, markDuplicate) {
  const flagged = [];
  for (const rec of importedWorkoutRecords) {
    if (rec.duplicateOf) continue;
    const match = (areteWorkouts || []).find((w) => !w.imported && workoutsOverlap(rec, w));
    if (match) {
      markDuplicate(rec.id, 'arete:' + match.id);
      flagged.push(rec.id);
    }
  }
  return flagged;
}

/** Records that count toward totals (audit-only duplicates excluded). */
export function countable(records) {
  return (records || []).filter((r) => !r.duplicateOf);
}
