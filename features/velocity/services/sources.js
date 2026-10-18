// Where velocity is measured — docs/velocity-tracking-plan.md, "Measurement rule".
//   Machines / cables (the body stays still, you move a handle): the hand.
//   Free weights (dumbbells, barbells): the weight itself.
// Set once per exercise, never guessed at runtime. Unknown or custom
// exercises default by equipment; anything else must be set explicitly.

export const VELOCITY_SOURCES = {
  // Free weights → the weight (plate / bar end, or the dumbbell head)
  'Back Squat': 'weight', 'Squat': 'weight', 'Bench Press': 'weight', 'Deadlift': 'weight',
  'Romanian Deadlift': 'weight', 'RDL': 'weight', 'Overhead Press': 'weight', 'Barbell Row': 'weight',
  'Dumbbell Curl': 'weight', 'Dumbbell Press': 'weight', 'Dumbbell Bench Press': 'weight',
  // Machines / cables → the hand (wrist / grip point)
  'Chest Press': 'hand', 'Tricep Pushdown': 'hand', 'Lat Pulldown': 'hand', 'Cable Row': 'hand',
  'Seated Cable Row': 'hand', 'Pec Deck': 'hand', 'Cable Curl': 'hand',
  // The "hand" here is the ankle pad — the moving contact point.
  'Leg Extension': 'hand', 'Leg Curl': 'hand',
};

/** Which body landmark is the "hand" for hand-mode exercises. */
const HAND_POINT = { 'leg extension': 'ankle', 'leg curl': 'ankle' };

const key = (name) => String(name || '').trim().toLowerCase();

/**
 * 'hand' | 'weight' | null for an exercise ({ name, equipment, velocitySource }).
 * An explicit velocitySource wins; then the table above; then equipment
 * (Machine / Cable → hand, Barbell / Dumbbell → weight). null = must be set.
 */
export function velocitySourceFor({ name, equipment, velocitySource } = {}) {
  if (velocitySource === 'hand' || velocitySource === 'weight') return velocitySource;
  const known = Object.keys(VELOCITY_SOURCES).find((n) => key(n) === key(name));
  if (known) return VELOCITY_SOURCES[known];
  const eq = key(equipment);
  if (eq === 'machine' || eq === 'cable') return 'hand';
  if (eq === 'barbell' || eq === 'dumbbell') return 'weight';
  return null;
}

/** For hand-mode exercises: 'wrist' (both hands averaged when visible) or 'ankle'. */
export const handPointFor = (name) => HAND_POINT[key(name)] || 'wrist';
