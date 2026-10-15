// Links between muscle-action entries and exercises, kept apart from both
// the muscle entries (static, from the source CSV) and the exercise records.
// Empty until exercises are supplied; nothing in the app writes here yet.
// Stored under a `jarvis_` key so it syncs with the user's account like the
// rest of the app's data once links exist.

const KEY = 'jarvis_muscle_exercise_links';

function storage(s) { return s || globalThis.localStorage; }

/** { [muscleActionId]: exerciseId[] } — {} when nothing has been linked. */
export function loadLinks(s) {
  try {
    const v = JSON.parse(storage(s).getItem(KEY));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}

/** Exercise ids linked to one muscle-action entry ([] when none). */
export function exercisesFor(muscleActionId, s) {
  const list = loadLinks(s)[muscleActionId];
  return Array.isArray(list) ? list.slice() : [];
}

/** Link an exercise to an entry. `validIds` guards against unknown entries. */
export function linkExercise(muscleActionId, exerciseId, validIds, s) {
  if (validIds && !validIds.has(muscleActionId)) throw new Error(`Unknown muscle-action entry: ${muscleActionId}`);
  if (!exerciseId) throw new Error('An exercise id is required');
  const links = loadLinks(s);
  const list = links[muscleActionId] || [];
  if (!list.includes(exerciseId)) links[muscleActionId] = list.concat(exerciseId);
  storage(s).setItem(KEY, JSON.stringify(links));
  return links;
}

export function unlinkExercise(muscleActionId, exerciseId, s) {
  const links = loadLinks(s);
  if (!links[muscleActionId]) return links;
  links[muscleActionId] = links[muscleActionId].filter((x) => x !== exerciseId);
  if (!links[muscleActionId].length) delete links[muscleActionId];
  storage(s).setItem(KEY, JSON.stringify(links));
  return links;
}

export const LINKS_KEY = KEY;
