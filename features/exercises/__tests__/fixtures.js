// SYNTHETIC TEST FIXTURES — not real exercises and never loaded by the app.
// Every id starts with 'syn-' and every name with 'Synthetic' so they can't
// be mistaken for catalogue data. Contribution values are chosen to exercise
// the comparison rules, not to describe any real machine.

const CHEST = 'pectoralis-major-middle-chest';            // spec: DESCENDING
const CHEST_ACT = 'transverse-plane-shoulder-horizontal-flexion';
const CHEST_UP_ACT = 'sagittal-plane-shoulder-flexion';
const DELT_MID = 'deltoid-middle';                        // spec: DESCENDING
const DELT_MID_ACT = 'frontal-plane-shoulder-abduction';
const TRI = 'triceps-brachii-lateral-and-medial-heads';   // spec: ASCENDING
const TRI_ACT = 'elbow-extension-with-shoulder-flexion';
const GLUTE = 'gluteus-maximus-lower';                    // spec: ASCENDING; 25–0° hip flexion
const GLUTE_ACT = 'hip-extension';
const QUAD = 'quadriceps-single-joint-quadriceps';        // spec: IRRELEVANT; ASCENDING preferred
const QUAD_ACT = 'knee-extension-with-hip-extension';
const LAT_UP = 'latissimus-dorsi-upper';                  // spec: ASCENDING
const LAT_UP_ACT = 'sagittal-plane-shoulder-extension';

export const IDS = { CHEST, CHEST_ACT, CHEST_UP_ACT, DELT_MID, DELT_MID_ACT, TRI, TRI_ACT, GLUTE, GLUTE_ACT, QUAD, QUAD_ACT, LAT_UP, LAT_UP_ACT };

const eq = (n) => ({ id: `syn-eq-${n}`, name: `Synthetic machine ${n}`, category: 'machine' });
const rec = (id, contributions, extra = {}) => ({ id, name: `Synthetic ${id.slice(4)}`, equipment: eq(id.slice(4)), variant: null, notes: '', contributions, ...extra });
const c = (target, action, profile, extra = {}) => ({ target, action, profile, rom: null, setup: {}, ...extra });

export const FIXTURES = [
  // Two pairs of identical chest contributions → two confirmed groups.
  rec('syn-chest-a1', [c(CHEST, CHEST_ACT, 'DESCENDING', { setup: { torso: 'upright' } })]),
  rec('syn-chest-a2', [c(CHEST, CHEST_ACT, 'DESCENDING', { setup: { torso: 'upright' } })]),
  rec('syn-chest-b1', [c(CHEST, CHEST_ACT, 'ASCENDING')]),
  rec('syn-chest-b2', [c(CHEST, CHEST_ACT, 'ASCENDING')]),
  // Same target, action and profile, but a different setup attribute.
  rec('syn-chest-grip-wide', [c(CHEST, CHEST_ACT, 'DESCENDING', { setup: { torso: 'upright', grip: 'wide' } })]),
  rec('syn-chest-grip-narrow', [c(CHEST, CHEST_ACT, 'DESCENDING', { setup: { torso: 'upright', grip: 'narrow' } })]),
  // Setup attribute known for only one → possible overlap.
  rec('syn-chest-grip-unknown', [c(CHEST, CHEST_ACT, 'DESCENDING', { setup: { torso: 'upright' } }), c(CHEST, CHEST_ACT, 'DESCENDING', { setup: { torso: 'upright' } })]),
  // Unknown profile, and N/A where the spec says the profile matters.
  rec('syn-chest-unknown', [c(CHEST, CHEST_ACT, 'Not specified')]),
  rec('syn-chest-na', [c(CHEST, CHEST_ACT, 'N/A')]),
  rec('syn-chest-noaction', [c(CHEST, null, 'DESCENDING')]),
  // Shares only the DESCENDING profile with the chest records.
  rec('syn-delt-desc', [c(DELT_MID, DELT_MID_ACT, 'DESCENDING')]),
  // Partial: chest with two actions vs chest with one.
  rec('syn-chest-two-actions', [c(CHEST, CHEST_ACT, 'DESCENDING', { setup: { torso: 'upright' } }), c(CHEST, CHEST_UP_ACT, 'DESCENDING', { setup: { torso: 'upright' } })]),
  // Compound: chest + triceps.
  rec('syn-press', [c(CHEST, CHEST_ACT, 'DESCENDING', { setup: { torso: 'upright' } }), c(TRI, TRI_ACT, 'ASCENDING', { setup: { shoulder: 'flexed' } })]),
  rec('syn-pushdown', [c(TRI, TRI_ACT, 'ASCENDING', { setup: { shoulder: 'neutral' } })]),
  // Angle ranges for a target whose spec gives one.
  rec('syn-glute-0-25', [c(GLUTE, GLUTE_ACT, 'ASCENDING', { rom: { joint: 'hip-flexion', start: 25, end: 0 } })]),
  rec('syn-glute-0-25-b', [c(GLUTE, GLUTE_ACT, 'ASCENDING', { rom: { joint: 'hip-flexion', start: 25, end: 0 } })]),
  rec('syn-glute-45-90', [c(GLUTE, GLUTE_ACT, 'ASCENDING', { rom: { joint: 'hip-flexion', start: 90, end: 45 } })]),
  rec('syn-glute-10-60', [c(GLUTE, GLUTE_ACT, 'ASCENDING', { rom: { joint: 'hip-flexion', start: 60, end: 10 } })]),
  rec('syn-glute-noangle', [c(GLUTE, GLUTE_ACT, 'ASCENDING')]),
  rec('syn-glute-noangle-b', [c(GLUTE, GLUTE_ACT, 'ASCENDING')]),
  // Profile irrelevant per spec: profiles differ, still compared on the rest.
  rec('syn-quad-asc', [c(QUAD, QUAD_ACT, 'ASCENDING')]),
  rec('syn-quad-desc', [c(QUAD, QUAD_ACT, 'DESCENDING')]),
  rec('syn-quad-unknown', [c(QUAD, QUAD_ACT, 'Not specified')]),
  // Different machine names, identical contributions.
  rec('syn-lat-machine-x', [c(LAT_UP, LAT_UP_ACT, 'ASCENDING')], { equipment: { id: 'syn-eq-x', name: 'Synthetic pulldown X', category: 'machine' } }),
  rec('syn-lat-machine-y', [c(LAT_UP, LAT_UP_ACT, 'ASCENDING')], { equipment: { id: 'syn-eq-y', name: 'Synthetic pulldown Y', category: 'cable' } }),
];

export const EQUIV = [
  { a: 'syn-chest-grip-wide', b: 'syn-chest-grip-narrow', target: CHEST, relation: 'same', note: 'synthetic review: grip judged not meaningful', reviewed: true },
  { a: 'syn-chest-a1', b: 'syn-chest-b1', target: CHEST, relation: 'same', note: 'unreviewed — must be ignored', reviewed: false },
];

let n = 0;
/** One planner row per catalogue id (set counts may be given and must not matter). */
export const sel = (catalogId, sets = 2) => ({ key: `row-${++n}`, name: `Synthetic ${String(catalogId).slice(4)}`, catalogId, sets });
