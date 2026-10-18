// Atomic machine actions → entries of the muscle-action specification
// (features/muscles, from Muscle_Actions_Updated_Profiles.csv). Pure.
//
// Only the specification's own wording is used. For each entry its action is
// read as:
//   core     — the movement, with the plane prefix dropped: "Sagittal plane
//              shoulder extension" is shoulder extension (flexion/extension
//              are sagittal-plane, ab/adduction frontal-plane and horizontal
//              movements transverse-plane by definition).
//   context  — a qualifier after "with"/"when" ("Knee flexion when hip is
//              flexed"). The machine rows never state these, so entries that
//              need one can't be confirmed — they are listed as unresolved.
//   either   — "Shoulder flexion or abduction" is met by either movement.
//
// A machine action then gives:
//   targets     — entries whose core is that action and need no context
//   candidates  — entries whose core is that action but need a context the
//                 row doesn't record (region not recorded)
//   unmapped    — the action appears in no entry ("not in your muscle list")
// The compound "knee and hip extension" matches the specification's own
// compound entry (Quadriceps — Squat pattern, "Knee extension plus hip
// extension"); the single-joint entries it would also touch are listed as
// candidates rather than assumed.

import { ATOMS } from './actions.js';
import { actionId } from '../../exercises/services/catalogue.js';

// Specification movement wording (after normalising) → machine atom.
const CORE_ATOMS = {
  'shoulder extension': 'shoulder-extension',
  'shoulder adduction': 'shoulder-adduction',
  'shoulder flexion': 'shoulder-flexion',
  'shoulder abduction': 'shoulder-abduction',
  'shoulder horizontal flexion': 'shoulder-horizontal-flexion',
  'shoulder horizontal extension': 'shoulder-horizontal-extension',
  'scapular retraction': 'scapular-retraction',
  'elbow extension': 'elbow-extension',
  'elbow flexion': 'elbow-flexion',
  'hip abduction': 'hip-abduction',
  'hip adduction': 'hip-adduction',
  'hip extension': 'hip-extension',
  'hip flexion': 'hip-flexion',
  'knee flexion': 'knee-flexion',
  'knee extension': 'knee-extension',
  'ankle plantar flexion': 'ankle-plantar-flexion',
  'knee extension plus hip extension': 'knee-and-hip-extension',
};
// Specification actions with no counterpart in the machine vocabulary.
export const NO_MACHINE_COUNTERPART = ['pulls clavicle backwards'];

// The specification's qualifiers, grouped by what they describe. Used to say
// which detail is missing ("hip position not recorded").
const CONTEXT_KEYS = {
  'shoulder extended and elbow flexed': 'shoulder position',
  'shoulder flexion': 'shoulder position',
  'flexed shoulder': 'shoulder position',
  'extended shoulder': 'shoulder position',
  'pronated grip': 'grip',
  'flexed hip': 'hip position',
  'hip is extended': 'hip position',
  'hip is flexed': 'hip position',
  'hip extension': 'hip position',
  'hip rotated inwards': 'hip rotation',
  'feet rotated outwards': 'foot rotation',
  'outward foot rotation': 'foot rotation',
  'inward foot rotation': 'foot rotation',
  'extended knee': 'knee position',
  'flexed knee': 'knee position',
};

/** Read one specification entry's action. */
export function readEntry(entry) {
  let s = entry.muscleAction.toLowerCase().replace(/-/g, ' ').replace(/^(sagittal|frontal|transverse) plane /, '');
  let context = null;
  const q = /^(.+?) (?:with|when) (.+)$/.exec(s);
  if (q) { s = q[1]; context = q[2]; }
  const either = /^shoulder flexion or abduction$/.test(s);
  const cores = either ? ['shoulder flexion', 'shoulder abduction'] : [s];
  const atoms = cores.map((c) => CORE_ATOMS[c] || null);
  if (atoms.includes(null) && !NO_MACHINE_COUNTERPART.includes(s)) {
    throw new Error(`Specification action "${entry.muscleAction}" has no machine counterpart and isn't listed as such`);
  }
  if (context && !CONTEXT_KEYS[context]) throw new Error(`Unrecognised specification qualifier "${context}" (${entry.id})`);
  return { atoms: atoms.filter(Boolean), context, contextKey: context ? CONTEXT_KEYS[context] : null, either };
}

/** Index the specification once: atom → { exact: [entry], qualified: [entry] }. */
export function indexSpecification(entries) {
  const byAtom = {};
  for (const atom of Object.keys(ATOMS)) byAtom[atom] = { exact: [], qualified: [] };
  const read = new Map();
  for (const e of entries) {
    const r = readEntry(e);
    read.set(e.id, r);
    for (const a of r.atoms) byAtom[a][r.context ? 'qualified' : 'exact'].push(e);
  }
  return { byAtom, read, entries, byId: new Map(entries.map((e) => [e.id, e])) };
}

const COMPOUND_PARTS = { 'knee-and-hip-extension': ['knee-extension', 'hip-extension'] };

/**
 * One mode's atoms → { targets, candidates, unmapped }.
 *   targets:    [{ entry, atom, basis: 'exact'|'either' , contextKeys }]
 *   candidates: [{ entry, atom, kind: 'context'|'compound-part'|'conditional', reason }]
 *   unmapped:   [atom]
 */
export function mapMode(mode, spec) {
  const targets = [], candidates = [], unmapped = [];
  const addTarget = (entry, atom, basis) => {
    if (targets.some((t) => t.entry.id === entry.id && t.atom === atom)) return;
    // Regions of the same movement that need a context: their keys tell the
    // overlap check which detail would separate two machines.
    const contextKeys = [...new Set(spec.byAtom[atom].qualified.map((q) => spec.read.get(q.id).contextKey))];
    targets.push({ entry, atom, basis, contextKeys });
  };
  const addCandidate = (entry, atom, kind, reason) => {
    if (candidates.some((c) => c.entry.id === entry.id && c.atom === atom)) return;
    candidates.push({ entry, atom, kind, reason });
  };
  const qualifiedReason = (entry) => {
    const r = spec.read.get(entry.id);
    return `region depends on ${r.contextKey} ("${r.context}"), which the machine record doesn't state`;
  };

  for (const atom of mode.atoms) {
    const hit = spec.byAtom[atom];
    if (!hit.exact.length && !hit.qualified.length) { unmapped.push(atom); continue; }
    for (const e of hit.exact) addTarget(e, atom, spec.read.get(e.id).either ? 'either' : 'exact');
    for (const e of hit.qualified) addCandidate(e, atom, 'context', qualifiedReason(e));
    for (const part of COMPOUND_PARTS[atom] || []) {
      for (const e of [...spec.byAtom[part].exact, ...spec.byAtom[part].qualified]) {
        addCandidate(e, atom, 'compound-part', `${ATOMS[part].toLowerCase()} is part of the recorded "knee and hip extension"; your muscle list files that compound under Quadriceps — Squat pattern, so whether it also counts for this region isn't stated`);
      }
    }
  }
  for (const atom of mode.conditional) {
    const hit = spec.byAtom[atom];
    if (!hit.exact.length && !hit.qualified.length) { if (!unmapped.includes(atom)) unmapped.push(atom); continue; }
    for (const e of [...hit.exact, ...hit.qualified]) addCandidate(e, atom, 'conditional', `${ATOMS[atom].toLowerCase()} is recorded only as conditional`);
  }
  // A region confirmed through one action isn't also unresolved.
  const confirmed = new Set(targets.map((t) => t.entry.id));
  return { targets, candidates: candidates.filter((c) => !confirmed.has(c.entry.id)), unmapped };
}

/** Muscle groups a mode certainly involves: target groups, plus a group when
 *  every candidate of an unresolved action belongs to it ("Elbow flexors"). */
export function modeGroups(mapped) {
  const groups = new Set(mapped.targets.map((t) => t.entry.group));
  const resolved = new Set(mapped.targets.map((t) => t.atom));
  const byAtom = new Map();
  for (const c of mapped.candidates) {
    if (resolved.has(c.atom) || c.kind !== 'context') continue;
    if (!byAtom.has(c.atom)) byAtom.set(c.atom, new Set());
    byAtom.get(c.atom).add(c.entry.group);
  }
  for (const gs of byAtom.values()) if (gs.size === 1) groups.add([...gs][0]);
  return [...groups];
}

/** Specification action id for an entry (the overlap catalogue's action key). */
export const entryActionId = (entry) => actionId(entry.muscleAction);
