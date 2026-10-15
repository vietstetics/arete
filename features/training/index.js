// Browser entry for training plans. Pages load this as a module; it exposes
// window.Training for the app's classic inline scripts and fires
// 'training-ready' once available.
//   <script type="module" src="features/training/index.js"></script>

import * as schedule from './services/schedule.js';
import * as consistency from './services/consistency.js';
import * as planStore from './repositories/planStore.js';
import { STARTERS, starterFor } from './data/starters.js';

const Training = {
  ...schedule,
  ...consistency,
  ...planStore,
  STARTERS,
  starterFor,
  /** Plan setup flow + Train-screen card (only the Train page needs these). */
  ui: () => Promise.all([import('./ui/planWizard.js'), import('./ui/planHome.js')]).then(([w, h]) => ({ ...w, ...h })),
};

window.Training = Training;
window.dispatchEvent(new Event('training-ready'));
