// Exercise-selection overlap and coverage — a planning aid, not a verdict on
// any exercise or workout. Built on the muscle-action specification
// (features/muscles) and the exercise catalogue (data/catalogue.js, empty
// until real records are supplied).
//
// Browser: imported by the plan wizard; also exposes window.ExerciseOverlap.

import { MUSCLE_ACTIONS } from '../muscles/data/muscleActions.js';
import { EXERCISES, EQUIVALENCES } from './data/catalogue.js';
import { buildCatalogue } from './services/catalogue.js';
import { analyseSession, selectionsFromRoutine, overlapLine } from './services/overlap.js';
import { sessionCoverage, weeklyCoverage } from './services/coverage.js';

export const catalogue = buildCatalogue({ entries: MUSCLE_ACTIONS, exercises: EXERCISES, equivalences: EQUIVALENCES });

export { analyseSession, selectionsFromRoutine, overlapLine, sessionCoverage, weeklyCoverage };

if (typeof window !== 'undefined') {
  window.ExerciseOverlap = { catalogue, analyseSession, selectionsFromRoutine, overlapLine, sessionCoverage, weeklyCoverage };
}
