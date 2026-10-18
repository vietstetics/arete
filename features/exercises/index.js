// Exercise-selection overlap and coverage — a planning aid, not a verdict on
// any exercise or workout. Built on the muscle-action specification
// (features/muscles). Records come from the machine database
// (features/machines: one per machine mode) plus data/catalogue.js for
// non-machine records, which stays empty until such records are supplied.
//
// Browser: imported by the plan wizard; also exposes window.ExerciseOverlap.

import { MUSCLE_ACTIONS } from '../muscles/data/muscleActions.js';
import { EXERCISES, EQUIVALENCES } from './data/catalogue.js';
import { machineDb } from '../machines/index.js';
import { buildCatalogue } from './services/catalogue.js';
import { analyseSession, selectionsFromRoutine, overlapLine } from './services/overlap.js';
import { sessionCoverage, weeklyCoverage } from './services/coverage.js';

export const catalogue = buildCatalogue({ entries: MUSCLE_ACTIONS, exercises: [...EXERCISES, ...machineDb.records()], equivalences: EQUIVALENCES });

export { analyseSession, selectionsFromRoutine, overlapLine, sessionCoverage, weeklyCoverage };

if (typeof window !== 'undefined') {
  window.ExerciseOverlap = { catalogue, analyseSession, selectionsFromRoutine, overlapLine, sessionCoverage, weeklyCoverage };
}
