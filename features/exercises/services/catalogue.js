// Catalogue indexing and validation. Pure: the muscle-action entries,
// exercise records and equivalences are passed in, so tests can use
// synthetic fixtures and the live app uses the real (empty) catalogue.

import { slug } from '../../muscles/services/parse.js';

// Profile values an exercise record may carry. 'IRRELEVANT' is a muscle-level
// statement in the specification, not a property of an exercise, so records
// can't use it.
export const RECORD_PROFILES = ['ASCENDING', 'DESCENDING', 'MID-RANGE', 'N/A', 'Not specified'];
export const EQUIPMENT_CATEGORIES = ['machine', 'cable', 'free-weight', 'bodyweight', 'other'];

/** Stable id for a muscle action, from the specification's own wording. */
export const actionId = (text) => slug(text);

/**
 * Actions named in the muscle-action specification, de-duplicated by id:
 * [{ id, label }]. 'Hip extension' appears for three regions but is one action.
 */
export function actionCatalogue(entries) {
  const out = new Map();
  for (const e of entries) {
    const id = actionId(e.muscleAction);
    if (!out.has(id)) out.set(id, { id, label: e.muscleAction });
  }
  return [...out.values()];
}

/**
 * How the specification asks a target to be compared.
 *   profileMatters — false when the spec says IRRELEVANT or N/A; 'Not
 *                    specified' is unknown, so the profile still counts.
 *   angleRange     — the spec states an angle range, so angle data is needed
 *                    before two selections can be confirmed as the same.
 *   preferred      — 'ASCENDING preferred' etc. Shown only; never scored.
 */
export function targetSpec(entry) {
  const t = entry.profile.type;
  return {
    profileMatters: t !== 'IRRELEVANT' && t !== 'N/A',
    angleRange: entry.profile.angleRange,
    preferred: entry.profile.preferred,
  };
}

/** Validation problems for one record ([] when it is usable). */
export function recordIssues(rec, entryIds, actionIds) {
  const out = [];
  if (!rec || typeof rec !== 'object') return ['not an object'];
  if (!rec.id || typeof rec.id !== 'string') out.push('missing id');
  if (!rec.name) out.push('missing name');
  if (rec.equipment && rec.equipment.category && !EQUIPMENT_CATEGORIES.includes(rec.equipment.category)) out.push(`unknown equipment category "${rec.equipment.category}"`);
  if (!Array.isArray(rec.contributions)) { out.push('contributions must be a list'); return out; }
  rec.contributions.forEach((c, i) => {
    const at = `contribution ${i + 1}`;
    if (!entryIds.has(c.target)) out.push(`${at}: unknown target "${c.target}"`);
    if (c.action != null && !actionIds.has(c.action)) out.push(`${at}: unknown action "${c.action}"`);
    if (c.profile != null && !RECORD_PROFILES.includes(c.profile)) out.push(`${at}: unknown profile "${c.profile}"`);
    if (c.rom != null) {
      const ok = typeof c.rom === 'object' && c.rom.joint && Number.isFinite(c.rom.start) && Number.isFinite(c.rom.end);
      if (!ok) out.push(`${at}: rom needs joint, start and end`);
    }
    if (c.setup != null && (typeof c.setup !== 'object' || Array.isArray(c.setup))) out.push(`${at}: setup must be an object of attributes`);
  });
  return out;
}

/**
 * Build the lookup the analysis uses. Invalid records are left out and
 * reported, never silently repaired.
 */
export function buildCatalogue({ entries, exercises = [], equivalences = [] }) {
  const entryById = new Map(entries.map((e) => [e.id, e]));
  const actions = actionCatalogue(entries);
  const actionIds = new Set(actions.map((a) => a.id));
  const byId = new Map();
  const issues = [];
  for (const rec of exercises) {
    const problems = recordIssues(rec, entryById, actionIds);
    if (rec && byId.has(rec.id)) problems.push('duplicate id');
    if (problems.length) { issues.push({ id: rec && rec.id, problems }); continue; }
    byId.set(rec.id, rec);
  }
  const eq = equivalences.filter((q) => q && q.reviewed === true && byId.has(q.a) && byId.has(q.b) && (q.relation === 'same' || q.relation === 'different'));
  return {
    entries, entryById, actions,
    actionLabel: (id) => (actions.find((a) => a.id === id) || {}).label || id,
    records: [...byId.values()],
    get: (id) => byId.get(id) || null,
    issues,
    /** Reviewed decision for two records (and a target), or null. */
    equivalence(a, b, target) {
      const hit = eq.find((q) => ((q.a === a && q.b === b) || (q.a === b && q.b === a)) && (!q.target || q.target === target));
      return hit || null;
    },
  };
}
