// Exercise catalogue for overlap / coverage analysis.
//
// EMPTY ON PURPOSE. Real records will be supplied later; nothing here is
// invented. Synthetic fixtures for tests live in __tests__/fixtures.js only.
//
// Record shape (see README.md for the full rules):
//
// {
//   id: 'ex-…',                       stable id; never reused for another exercise
//   name: 'Display name',             shown in the UI, never used for matching
//   equipment: { id: 'eq-…', name: 'Machine / implement', category: 'machine' | 'cable' | 'free-weight' | 'bodyweight' | 'other' },
//   variant: { id: 'var-…', name: 'Meaningful setup variation' } | null,
//   notes: 'Descriptive setup notes (shown, not compared)',
//   contributions: [{
//     target: '<muscle-action entry id from features/muscles>',   target muscle / region
//     action: '<action id from the action catalogue>',            muscle action performed
//     profile: 'ASCENDING' | 'DESCENDING' | 'MID-RANGE' | 'N/A' | 'Not specified',
//                                     this exercise's own profile, not the muscle-level spec
//     rom: { joint: 'hip-flexion', start: 90, end: 0 } | null,   angle range in degrees
//     setup: { shoulder: 'flexed', grip: 'pronated', … },        discriminating setup attributes
//   }],
// }

export const EXERCISES = [];

// Reviewed equivalence decisions between two records, optionally for one
// target. They override the automatic comparison and are never inferred.
// { a: 'ex-…', b: 'ex-…', target: '<entry id>' | null, relation: 'same' | 'different', note: 'why', reviewed: true }
export const EQUIVALENCES = [];
