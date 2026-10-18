// The "Muscle action" column → modes and atomic actions. Pure.
//
// The column uses a small, consistent vocabulary, so it is parsed with an
// explicit phrase table rather than guessed at: every clause, mode label and
// note must be one this file knows, or parsing throws (the generator and the
// tests then fail and name the new wording). Nothing is inferred from the
// machine's name here.
//
// Output for one row:
//   { modes: [{ key, label, atoms, conditional, notes }], recorded: bool }
//   atoms        — actions the row states the mode performs
//   conditional  — actions it says may or may not be involved
//                  ("may be added", "depending on technique")
//   notes        — qualifiers kept verbatim ("humeral plane depends on grip")

export const ATOMS = {
  'shoulder-extension': 'Shoulder extension',
  'shoulder-adduction': 'Shoulder adduction',
  'shoulder-flexion': 'Shoulder flexion',
  'shoulder-abduction': 'Shoulder abduction',
  'shoulder-horizontal-flexion': 'Shoulder horizontal flexion',
  'shoulder-horizontal-extension': 'Shoulder horizontal extension',
  'shoulder-internal-rotation': 'Shoulder internal rotation',
  'shoulder-external-rotation': 'Shoulder external rotation',
  'elbow-flexion': 'Elbow flexion',
  'elbow-extension': 'Elbow extension',
  'scapular-retraction': 'Scapular retraction',
  'scapular-elevation': 'Scapular elevation',
  'hip-extension': 'Hip extension',
  'hip-flexion': 'Hip flexion',
  'hip-abduction': 'Hip abduction',
  'hip-adduction': 'Hip adduction',
  'knee-extension': 'Knee extension',
  'knee-flexion': 'Knee flexion',
  'knee-and-hip-extension': 'Knee and hip extension',
  'ankle-plantar-flexion': 'Ankle plantar flexion',
  'ankle-dorsiflexion': 'Ankle dorsiflexion',
  'trunk-flexion': 'Trunk flexion',
  'trunk-extension': 'Trunk extension',
  'trunk-rotation': 'Trunk rotation',
  'cervical-flexion': 'Cervical flexion',
  'cervical-extension': 'Cervical extension',
  'cervical-lateral-flexion': 'Cervical lateral flexion',
  'wrist-flexion': 'Wrist flexion',
  'wrist-extension': 'Wrist extension',
  'forearm-supination': 'Forearm supination',
  'forearm-pronation': 'Forearm pronation',
  'finger-flexion': 'Finger flexion',
};

const ELEVATION = "'elevation' read as shoulder flexion/abduction, as the database itself glosses it ('flexion/abduction (elevation)')";

// Clauses, lower case. A slash lists alternatives the row records together
// ("adduction/extension"); both are kept.
const CLAUSES = {
  'knee and hip extension': { atoms: ['knee-and-hip-extension'] },
  'hip and knee extension': { atoms: ['knee-and-hip-extension'] },
  'shoulder adduction/extension': { atoms: ['shoulder-adduction', 'shoulder-extension'] },
  'shoulder extension/horizontal extension': { atoms: ['shoulder-extension', 'shoulder-horizontal-extension'] },
  'shoulder extension': { atoms: ['shoulder-extension'] },
  'shoulder horizontal flexion/flexion': { atoms: ['shoulder-horizontal-flexion', 'shoulder-flexion'] },
  'shoulder horizontal flexion': { atoms: ['shoulder-horizontal-flexion'] },
  'shoulder horizontal extension': { atoms: ['shoulder-horizontal-extension'] },
  'shoulder flexion/abduction (elevation)': { atoms: ['shoulder-flexion', 'shoulder-abduction'] },
  'shoulder flexion/elevation': { atoms: ['shoulder-flexion', 'shoulder-abduction'], notes: [ELEVATION] },
  'shoulder elevation': { atoms: ['shoulder-flexion', 'shoulder-abduction'], notes: [ELEVATION] },
  'shoulder abduction': { atoms: ['shoulder-abduction'] },
  'elbow flexion': { atoms: ['elbow-flexion'] },
  'elbow extension with shoulder motion': { atoms: ['elbow-extension'], notes: ['with shoulder motion (the shoulder action is not specified)'] },
  'elbow extension': { atoms: ['elbow-extension'] },
  'scapular retraction': { atoms: ['scapular-retraction'] },
  'scapular elevation': { atoms: ['scapular-elevation'] },
  'knee flexion against the body-lowering load': { atoms: ['knee-flexion'], notes: ['against the body-lowering load'] },
  'knee flexion': { atoms: ['knee-flexion'] },
  'knee extension': { atoms: ['knee-extension'] },
  'hip extension': { atoms: ['hip-extension'] },
  'hip abduction': { atoms: ['hip-abduction'] },
  'hip adduction': { atoms: ['hip-adduction'] },
  'hip flexion': { atoms: ['hip-flexion'] },
  'trunk flexion': { atoms: ['trunk-flexion'] },
  'trunk extension': { atoms: ['trunk-extension'] },
  'trunk rotation': { atoms: ['trunk-rotation'] },
  'ankle plantar flexion': { atoms: ['ankle-plantar-flexion'] },
  'ankle dorsiflexion': { atoms: ['ankle-dorsiflexion'] },
  'finger flexion': { atoms: ['finger-flexion'] },
  'forearm pronation': { atoms: ['forearm-pronation'] },
  'forearm supination': { atoms: ['forearm-supination'] },
};

// Notes after "; " that qualify the whole row rather than name a mode.
const NOTES = {
  'humeral plane depends on grip': { flag: 'plane-depends-on-grip' },
  'grip determines plane': { flag: 'plane-depends-on-grip' },
  'dip/pushdown shoulder contribution depends on setup': { flag: 'depends-on-setup' },
  'assisted return as configured': {},
  'hip extension may be added through a combined glute-ham raise': { conditional: ['hip-extension'] },
};

// Mode labels as written ("Pulldown:", "Chin mode:") → stable mode keys.
const MODE_LABELS = {
  'pulldown': 'pulldown', 'pulldown mode': 'pulldown', 'row': 'row', 'row modes': 'row',
  'chin mode': 'chin', 'dip mode': 'dip', 'pec mode': 'pec', 'rear-delt mode': 'rear-delt',
  'extension mode': 'extension', 'curl mode': 'curl', 'triceps mode': 'triceps', 'pushdown mode': 'pushdown',
  'adductor mode': 'adduction', 'abductor mode': 'abduction',
  'chest modes': 'chest', 'overhead mode': 'overhead', 'chest press': 'chest-press', 'press': 'press', 'press mode': 'press',
  'abdominal mode': 'abdominal', 'back mode': 'back', 'shrug mode': 'shrug', 'deadlift mode': 'deadlift',
  'leg press': 'leg-press', 'squat': 'squat', 'calf mode': 'calf', 'side raise': 'side-raise', 'rear raise': 'rear-raise',
};

// Whole rows that enumerate modes in prose, written out exactly.
const ENUMERATIONS = {
  'by mode: hip flexion, extension, abduction or adduction': [
    ['hip-flexion', 'Hip flexion'], ['hip-extension', 'Hip extension'], ['hip-abduction', 'Hip abduction'], ['hip-adduction', 'Hip adduction']],
  'by exercise: wrist flexion/extension, forearm supination/pronation or finger flexion': [
    ['wrist-flexion', 'Wrist flexion'], ['wrist-extension', 'Wrist extension'], ['forearm-supination', 'Forearm supination'],
    ['forearm-pronation', 'Forearm pronation'], ['finger-flexion', 'Finger flexion']],
  'cervical flexion/extension and lateral flexion, by exercise direction': [
    ['cervical-flexion', 'Flexion'], ['cervical-extension', 'Extension'], ['cervical-lateral-flexion', 'Lateral flexion']],
  'shoulder internal/external rotation, depending on selected mode': [
    ['shoulder-internal-rotation', 'Internal rotation'], ['shoulder-external-rotation', 'External rotation']],
};

// One row combining a stated action with a conditional one.
const SPECIAL = {
  'hip extension, with knee extension depending on technique': { atoms: ['hip-extension'], conditional: ['knee-extension'], notes: ['knee extension depending on technique'] },
};

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** A clause list ("a, b and c") → { atoms, notes } via longest known clause. */
export function parseClauses(text) {
  const src = text.trim().toLowerCase();
  const keys = Object.keys(CLAUSES).sort((a, b) => b.length - a.length);
  const atoms = [], notes = [];
  let i = 0;
  while (i < src.length) {
    const k = keys.find((c) => src.startsWith(c, i));
    if (!k) throw new Error(`Unrecognised muscle action wording: "${text.slice(i)}" in "${text}"`);
    for (const a of CLAUSES[k].atoms) if (!atoms.includes(a)) atoms.push(a);
    notes.push(...(CLAUSES[k].notes || []));
    i += k.length;
    const sep = /^(?:, and |, | and )/.exec(src.slice(i));
    if (sep) i += sep[0].length;
    else if (i < src.length) throw new Error(`Unrecognised muscle action wording: "${text.slice(i)}" in "${text}"`);
  }
  return { atoms, notes };
}

/** The whole cell → { recorded, modes }. Blank cells record no action. */
export function parseAction(cell) {
  const raw = String(cell ?? '').trim();
  if (!raw) return { recorded: false, modes: [] };
  const body = raw.replace(/\.$/, '');
  const lower = body.toLowerCase();

  if (ENUMERATIONS[lower]) {
    return { recorded: true, modes: ENUMERATIONS[lower].map(([atom, label]) => ({ key: atom, label, atoms: [atom], conditional: [], notes: [], flags: [] })) };
  }
  if (SPECIAL[lower]) {
    const s = SPECIAL[lower];
    return { recorded: true, modes: [{ key: 'main', label: null, atoms: s.atoms.slice(), conditional: s.conditional.slice(), notes: s.notes.slice(), flags: [] }] };
  }

  const parts = body.split('; ');
  const modes = [];
  const shared = { conditional: [], notes: [], flags: [] };
  for (const part of parts) {
    const m = /^([A-Za-z][A-Za-z -]*?): (.+)$/.exec(part);
    if (m) {
      const key = MODE_LABELS[m[1].toLowerCase()];
      if (!key) throw new Error(`Unrecognised mode label "${m[1]}" in "${raw}"`);
      const c = parseClauses(m[2]);
      modes.push({ key, label: cap(m[1].replace(/ modes?$/i, '')), atoms: c.atoms, conditional: [], notes: c.notes, flags: [] });
    } else if (!modes.length && parts.indexOf(part) === 0) {
      const c = parseClauses(part);
      modes.push({ key: 'main', label: null, atoms: c.atoms, conditional: [], notes: c.notes, flags: [] });
    } else {
      const n = NOTES[part.toLowerCase()];
      if (!n) throw new Error(`Unrecognised muscle action note "${part}" in "${raw}"`);
      shared.notes.push(part);
      shared.conditional.push(...(n.conditional || []));
      if (n.flag) shared.flags.push(n.flag);
    }
  }
  for (const mode of modes) {
    mode.conditional.push(...shared.conditional);
    mode.notes.push(...shared.notes);
    mode.flags.push(...shared.flags);
  }
  return { recorded: true, modes };
}
