// Exercise taxonomy for the machine database. Hand-written and reviewed:
// these are exercise names and groupings, not muscle mappings. Targeted
// muscles always come from each machine's recorded action (services/muscles.js).
//
// LIBRARY      — names that already exist in the app's exercise library
//                (js/fitness.js); the tests check every one of them.
// NEW_EXERCISES — machine movements the library had no exercise for. For the
//                recovery body map each borrows the muscle map of the library
//                exercise it is `like`; none is invented. `aliases` derives one
//                from the specification instead; `none` leaves it empty
//                (the body map has no region for it).
// FAMILIES     — exercises that are variations of one movement, so a machine
//                for one is offered as a related machine for the others.
// STATIONS     — general-purpose equipment with no recorded muscle action.

export const NEW_EXERCISES = {
  'Machine Row': { like: 'Cable Row' },
  'T-Bar Row': { like: 'Barbell Row' },
  'High Row': { like: 'Cable Row' },
  'Decline Machine Press': { like: 'Flat Machine Chest Press' },
  'Machine Shoulder Press': { like: 'Full-ROM Machine Shoulder Press' },
  'Machine Biceps Curl': { like: 'Machine Preacher Curl' },
  'Machine Triceps Extension': { like: 'Cable Triceps Pushdown' },
  'Machine Overhead Triceps Extension': { like: 'Overhead Cable Triceps Extension' },
  'Belt Squat': { like: 'Hack Squat' },
  'Machine Squat': { like: 'Hack Squat' },
  'Kneeling Leg Curl': { like: 'Leg Curl' },
  'Standing Leg Curl': { like: 'Leg Curl' },
  'Reverse Hyperextension': { like: 'Machine Hip Extension' },
  'Glute-Ham Raise': { like: 'Leg Curl' },
  'Nordic Curl': { like: 'Leg Curl' },
  'Hip Abduction Machine': { like: 'Cable Hip Abduction' },
  // Specification: hip flexion → Quadriceps — Two-joint rectus femoris (upper region).
  'Machine Hip Flexion': { aliases: { primary: ['rectus_femoris'], secondary: [] } },
  'Rotary Torso': { like: 'Russian Twist' },
  'Machine Deadlift': { like: 'Deadlift' },
  'Machine Pullover': { like: 'Cable Pullover' },
  'Neck Machine': { none: true },
  'Wrist Curl': { like: 'Cable Wrist Curl' },
  'Wrist Extension': { like: 'Cable Wrist Extension' },
  'Machine External Rotation': { none: true },
  'Machine Internal Rotation': { none: true },
  'Assisted Pull-Up': { like: 'Pull-Up' },
  'Assisted Dip': { like: 'Dip' },
};

// Library names this file refers to (machine targets, family members, station lists).
export const LIBRARY = [
  'Lat Pulldown', 'Medium-Grip Lat Pulldown', 'Neutral-Grip Lat Pulldown', 'Single-Arm Cable Lat Pulldown', 'Pull-Up',
  'Cable Row', 'Chest-Supported Upper-Back Row', 'Wide Chest-Supported Row', 'One-Arm Lat-Focused Row', 'Barbell Row',
  'Flat Machine Chest Press', 'Converging Chest Press', 'Incline Machine Press', 'Close-Grip Machine Press', 'Bench Press', 'Incline Bench', 'Low-Incline Smith Press',
  'Pec Deck', 'Cable Fly', 'Dumbbell Fly',
  'Reverse Pec Deck', 'Rear Delt Fly', 'Cable Rear-Delt Fly', 'Face Pull',
  'Full-ROM Machine Shoulder Press', 'Top-Half Shoulder Press', 'Overhead Press',
  'Machine Lateral Raise', 'Lateral Raise', 'Cable Lateral Raise', 'Dumbbell Lateral Raise', 'Cable Front Raise',
  'Machine Preacher Curl', 'Preacher Curl', 'Barbell Curl', 'Hammer Curl', 'Recline Curl', 'Recline Dumbbell Curl', 'Recline Cable Curl',
  'Bayesian Cable Curl', 'Preacher Hammer Curl', 'Supinated Cable Curl', 'Reverse Curl',
  'Tricep Pushdown', 'Cable Triceps Pushdown', 'Overhead Cable Triceps Extension', 'Single-Arm Overhead Triceps Extension',
  'Single-Arm Cross-Body Triceps Extension', 'Skull Crusher', 'Cable Skull Crusher', 'JM Press',
  'Machine Dip', 'Dip', 'Chest-Biased Assisted Dip',
  'Leg Press', 'Hack Squat', 'Pendulum Squat', 'Smith Machine Squat', 'Squat', 'Sumo Squat', 'Lunge', 'Bulgarian Split Squat',
  'Leg Extension', 'Reclined Leg Extension',
  'Leg Curl', 'Seated Leg Curl', 'Prone Leg Curl',
  'Calf Raise', 'Standing Calf Raise', 'Seated Calf Raise', 'Leg-Press Calf Raise',
  'Hip Thrust', 'Machine Hip Extension', '45-Degree Back Extension',
  'Cable Hip Abduction', 'Hip Adduction Machine', 'Cable Adduction',
  'Hanging Knee Raise', 'Hanging Leg Raise',
  'Back Extension', 'Good Morning',
  'Machine Abdominal Crunch', 'Crunch', 'Cable Crunch', 'Reverse Crunch',
  'Russian Twist', 'Pallof Press',
  'Machine Shrug', 'Shrug', 'Upright Row',
  'Deadlift', 'Romanian Deadlift', 'Stiff-Leg Deadlift',
  'Cable Pullover',
  'Tibialis Raise',
  'Wrist Pronation', 'Wrist Supination', 'Finger Curl', 'Cable Wrist Curl', 'Cable Wrist Extension',
];

export const FAMILIES = [
  { key: 'pulldown', label: 'Pulldowns', exercises: ['Lat Pulldown', 'Medium-Grip Lat Pulldown', 'Neutral-Grip Lat Pulldown', 'Single-Arm Cable Lat Pulldown', 'Assisted Pull-Up', 'Pull-Up'] },
  { key: 'row', label: 'Rows', exercises: ['Machine Row', 'T-Bar Row', 'High Row', 'Cable Row', 'Chest-Supported Upper-Back Row', 'Wide Chest-Supported Row', 'One-Arm Lat-Focused Row', 'Barbell Row'] },
  { key: 'chest-press', label: 'Chest presses', exercises: ['Flat Machine Chest Press', 'Converging Chest Press', 'Incline Machine Press', 'Decline Machine Press', 'Close-Grip Machine Press', 'Bench Press', 'Incline Bench', 'Low-Incline Smith Press'] },
  { key: 'fly', label: 'Chest flies', exercises: ['Pec Deck', 'Cable Fly', 'Dumbbell Fly'] },
  { key: 'rear-delt', label: 'Rear-delt flies', exercises: ['Reverse Pec Deck', 'Rear Delt Fly', 'Cable Rear-Delt Fly', 'Face Pull'] },
  { key: 'shoulder-press', label: 'Shoulder presses', exercises: ['Machine Shoulder Press', 'Full-ROM Machine Shoulder Press', 'Top-Half Shoulder Press', 'Overhead Press'] },
  { key: 'lateral-raise', label: 'Lateral raises', exercises: ['Machine Lateral Raise', 'Lateral Raise', 'Cable Lateral Raise', 'Dumbbell Lateral Raise'] },
  { key: 'curl', label: 'Biceps curls', exercises: ['Machine Biceps Curl', 'Machine Preacher Curl', 'Preacher Curl', 'Barbell Curl', 'Hammer Curl', 'Recline Curl', 'Recline Dumbbell Curl', 'Recline Cable Curl', 'Bayesian Cable Curl', 'Preacher Hammer Curl', 'Supinated Cable Curl', 'Reverse Curl'] },
  { key: 'triceps', label: 'Triceps extensions', exercises: ['Machine Triceps Extension', 'Machine Overhead Triceps Extension', 'Tricep Pushdown', 'Cable Triceps Pushdown', 'Overhead Cable Triceps Extension', 'Single-Arm Overhead Triceps Extension', 'Single-Arm Cross-Body Triceps Extension', 'Skull Crusher', 'Cable Skull Crusher', 'JM Press'] },
  { key: 'dip', label: 'Dips', exercises: ['Machine Dip', 'Assisted Dip', 'Dip', 'Chest-Biased Assisted Dip'] },
  { key: 'squat', label: 'Squats and leg presses', exercises: ['Leg Press', 'Hack Squat', 'Pendulum Squat', 'Belt Squat', 'Machine Squat', 'Smith Machine Squat', 'Squat', 'Sumo Squat', 'Lunge', 'Bulgarian Split Squat'] },
  { key: 'leg-extension', label: 'Leg extensions', exercises: ['Leg Extension', 'Reclined Leg Extension'] },
  { key: 'leg-curl', label: 'Leg curls', exercises: ['Leg Curl', 'Seated Leg Curl', 'Prone Leg Curl', 'Kneeling Leg Curl', 'Standing Leg Curl', 'Glute-Ham Raise', 'Nordic Curl'] },
  { key: 'calf', label: 'Calf raises', exercises: ['Calf Raise', 'Standing Calf Raise', 'Seated Calf Raise', 'Leg-Press Calf Raise'] },
  { key: 'hip-extension', label: 'Hip thrusts and extensions', exercises: ['Hip Thrust', 'Machine Hip Extension', 'Reverse Hyperextension', '45-Degree Back Extension'] },
  { key: 'abduction', label: 'Hip abduction', exercises: ['Hip Abduction Machine', 'Cable Hip Abduction'] },
  { key: 'adduction', label: 'Hip adduction', exercises: ['Hip Adduction Machine', 'Cable Adduction'] },
  { key: 'hip-flexion', label: 'Hip flexion', exercises: ['Machine Hip Flexion', 'Hanging Knee Raise', 'Hanging Leg Raise'] },
  { key: 'back-extension', label: 'Back extensions', exercises: ['Back Extension', 'Good Morning'] },
  { key: 'abs', label: 'Ab crunches', exercises: ['Machine Abdominal Crunch', 'Crunch', 'Cable Crunch', 'Reverse Crunch'] },
  { key: 'rotation', label: 'Trunk rotation', exercises: ['Rotary Torso', 'Russian Twist', 'Pallof Press'] },
  { key: 'shrug', label: 'Shrugs', exercises: ['Machine Shrug', 'Shrug'] },
  { key: 'deadlift', label: 'Deadlifts', exercises: ['Machine Deadlift', 'Deadlift', 'Romanian Deadlift', 'Stiff-Leg Deadlift'] },
  { key: 'pullover', label: 'Pullovers', exercises: ['Machine Pullover', 'Cable Pullover'] },
  { key: 'tibialis', label: 'Tibialis', exercises: ['Tibialis Raise'] },
  { key: 'neck', label: 'Neck', exercises: ['Neck Machine'] },
  { key: 'forearm', label: 'Forearms and grip', exercises: ['Wrist Curl', 'Wrist Extension', 'Wrist Pronation', 'Wrist Supination', 'Finger Curl', 'Cable Wrist Curl', 'Cable Wrist Extension'] },
  { key: 'rotator-cuff', label: 'Rotator cuff', exercises: ['Machine External Rotation', 'Machine Internal Rotation'] },
];

// Library exercises performed on a cable station (by their own names, plus the
// three whose names don't say "cable").
export const CABLE_EXERCISES = [
  'Cable Fly', 'Cable Row', 'Single-Arm Cable Lat Pulldown', 'Cable Pullover', 'Cable Lateral Raise', 'Cable Rear-Delt Fly',
  'Cable Front Raise', 'Recline Cable Curl', 'Bayesian Cable Curl', 'Supinated Cable Curl', 'Overhead Cable Triceps Extension',
  'Cable Triceps Pushdown', 'Single-Arm Cross-Body Triceps Extension', 'Cable Skull Crusher', 'Cable Adduction',
  'Cable Hip Abduction', 'Cable Crunch', 'Cable Wrist Curl', 'Cable Wrist Extension', 'Face Pull', 'Tricep Pushdown', 'Pallof Press',
];
// Smith machines: their own library exercises, then barbell lifts a Smith
// machine can replace (offered as related, never as an exact match).
export const SMITH_EXERCISES = ['Smith Machine Squat', 'Low-Incline Smith Press'];
export const SMITH_RELATED = [
  'Squat', 'Bench Press', 'Incline Bench', 'Overhead Press', 'Romanian Deadlift', 'Stiff-Leg Deadlift', 'Deadlift', 'Shrug',
  'Lunge', 'Bulgarian Split Squat', 'Calf Raise', 'Standing Calf Raise', 'Hip Thrust', 'Barbell Row', 'Upright Row', 'Sumo Squat',
  'Good Morning', 'JM Press',
];

export const STATIONS = {
  cable: { label: 'Cable station', exercises: CABLE_EXERCISES, basis: 'station' },
  smith: { label: 'Smith machine', exercises: SMITH_EXERCISES, related: SMITH_RELATED, basis: 'station' },
  multi: { label: 'Multi-station', related: CABLE_EXERCISES, basis: 'station-unconfirmed' },
};
