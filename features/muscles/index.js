// Muscle-action database: the foundation for future workout creation.
// 34 muscle regions / actions with their resistance-profile specifications,
// generated verbatim from Muscle_Actions_Updated_Profiles.csv. It contains no
// exercises; exercise links are a separate, currently empty store.
//
// Browser: <script type="module" src="features/muscles/index.js"></script>
// exposes window.MuscleDB and fires 'muscledb-ready'.

import { MUSCLE_ACTIONS, MUSCLE_DB_NOTES, MUSCLE_DB_META } from './data/muscleActions.js';
import { PROFILE_TYPES } from './services/parse.js';
import { exercisesFor, linkExercise, unlinkExercise, loadLinks } from './repositories/exerciseLinks.js';

function deepFreeze(o) {
  Object.values(o).forEach((v) => { if (v && typeof v === 'object') deepFreeze(v); });
  return Object.freeze(o);
}
const entries = deepFreeze(MUSCLE_ACTIONS.map((e) => ({ ...e, profile: { ...e.profile } })));
const notes = deepFreeze({ ...MUSCLE_DB_NOTES, items: MUSCLE_DB_NOTES.items.map((n) => ({ ...n })) });
const byId = new Map(entries.map((e) => [e.id, e]));
const ids = new Set(byId.keys());

/** Groups in source order, e.g. ['Latissimus dorsi', 'Pectoralis major', …]. */
export function groups() { return [...new Set(entries.map((e) => e.group))]; }

/**
 * Entries filtered by group, profile type and free text (muscle name, action
 * or profile wording). Source order is preserved.
 */
export function query({ group = '', type = '', text = '' } = {}) {
  const q = text.trim().toLowerCase();
  return entries.filter((e) =>
    (!group || e.group === group) &&
    (!type || e.profile.type === type) &&
    (!q || `${e.muscle} ${e.muscleAction} ${e.resistanceProfile}`.toLowerCase().includes(q)));
}

export const MuscleDB = {
  meta: MUSCLE_DB_META,
  entries,
  notes,
  PROFILE_TYPES,
  get: (id) => byId.get(id) || null,
  groups,
  query,
  exercisesFor: (id) => exercisesFor(id),
  linkExercise: (id, exerciseId) => linkExercise(id, exerciseId, ids),
  unlinkExercise: (id, exerciseId) => unlinkExercise(id, exerciseId),
  linkedCount: () => Object.values(loadLinks()).reduce((n, l) => n + (Array.isArray(l) ? l.length : 0), 0),
};

if (typeof window !== 'undefined') {
  window.MuscleDB = MuscleDB;
  window.dispatchEvent(new Event('muscledb-ready'));
}
