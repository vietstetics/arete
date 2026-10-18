// Strength-machine database (913 machines from Strength_Machines_App_Database
// - Machines.csv). Each machine is matched to exercises, its recorded muscle
// action is mapped onto the muscle-action specification (features/muscles),
// and anything that can't be mapped cleanly is flagged — see README.md.
//
// Browser: <script type="module" src="features/machines/index.js"></script>
// exposes window.Machines and fires 'machines-ready'. The picker/browser UI
// loads on demand: window.Machines.ui().

import { MACHINE_ROWS, MACHINE_DB_META } from './data/machines.js';
import { MUSCLE_ACTIONS } from '../muscles/data/muscleActions.js';
import { createMachineDb, recordId, UNLISTED, UNRECORDED } from './services/db.js';

export const machineDb = createMachineDb(MACHINE_ROWS, MUSCLE_ACTIONS);
export { recordId, MACHINE_DB_META, UNLISTED, UNRECORDED };

if (typeof window !== 'undefined' && !window.Machines) {
  window.Machines = {
    db: machineDb,
    meta: MACHINE_DB_META,
    recordId,
    ui: () => import('./ui/machineUI.js'),
  };
  window.dispatchEvent(new Event('machines-ready'));
}
