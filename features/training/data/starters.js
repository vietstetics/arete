// Starter routines offered (never forced) when a workout type is empty.
// Names match the exercise library in js/fitness.js so muscles map onto the
// recovery body map. Format: [name, sets, repMin, repMax, rir].

const S = (name, sets, repMin, repMax, rir) => ({ name, sets, repMin, repMax, rir });

export const STARTERS = {
  'Push': [S('Bench Press', 2, 4, 8, 1), S('Overhead Press', 2, 6, 10, 1), S('Incline Bench', 2, 6, 10, 1), S('Lateral Raise', 2, 8, 12, 0), S('Tricep Pushdown', 2, 8, 12, 0)],
  'Pull': [S('Lat Pulldown', 2, 6, 10, 1), S('Cable Row', 2, 6, 10, 1), S('Face Pull', 2, 10, 15, 0), S('Barbell Curl', 2, 8, 12, 0), S('Hammer Curl', 2, 8, 12, 0)],
  'Legs': [S('Squat', 2, 4, 8, 1), S('Romanian Deadlift', 2, 6, 10, 1), S('Leg Press', 2, 8, 12, 1), S('Leg Curl', 2, 8, 12, 0), S('Calf Raise', 2, 8, 12, 0)],
  'Upper': [S('Bench Press', 2, 4, 8, 1), S('Lat Pulldown', 2, 6, 10, 1), S('Overhead Press', 2, 6, 10, 1), S('Cable Row', 2, 6, 10, 1), S('Lateral Raise', 2, 8, 12, 0)],
  'Lower': [S('Squat', 2, 4, 8, 1), S('Romanian Deadlift', 2, 6, 10, 1), S('Leg Extension', 2, 8, 12, 0), S('Leg Curl', 2, 8, 12, 0), S('Calf Raise', 2, 8, 12, 0)],
  'Anterior': [S('Bench Press', 2, 4, 8, 1), S('Squat', 2, 4, 8, 1), S('Overhead Press', 2, 6, 10, 1), S('Leg Extension', 2, 8, 12, 0), S('Crunch', 2, 10, 15, 0)],
  'Posterior': [S('Romanian Deadlift', 2, 6, 10, 1), S('Pull-Up', 2, 6, 10, 1), S('Cable Row', 2, 6, 10, 1), S('Leg Curl', 2, 8, 12, 0), S('Face Pull', 2, 10, 15, 0)],
  'Full Body': [S('Squat', 2, 4, 8, 1), S('Bench Press', 2, 4, 8, 1), S('Lat Pulldown', 2, 6, 10, 1), S('Romanian Deadlift', 2, 6, 10, 1), S('Lateral Raise', 2, 8, 12, 0)],
};

/** Starter exercises for a routine name ('Full Body B' → 'Full Body'), or null. */
export function starterFor(name) {
  const base = String(name || '').replace(/\s+[A-Z]$/, '').trim();
  return STARTERS[base] || null;
}
