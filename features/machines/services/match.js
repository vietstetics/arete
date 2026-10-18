// Machine → exercise(s). Pure.
//
// Each recorded mode is matched by its action first (a lat pulldown is a
// pulldown because the row records "shoulder adduction/extension and elbow
// flexion"), and the machine's name then picks the exercise within that
// movement (seated vs lying leg curl, decline vs flat press). Anything the
// rules can't place — a name that contradicts the action, a mode the name
// doesn't mention — is flagged rather than resolved. Machines with no
// recorded action are general-purpose stations when their name says so
// (cable, Smith, multi-station), otherwise unmatched.

import { STATIONS } from '../data/exercises.js';

const sig = (atoms) => [...atoms].sort().join('+');
const assisted = (n) => /assist|counterbalanced/.test(n);

function rowType(n) {
  if (/t-?bar/.test(n)) return 'T-Bar Row';
  if (/high row/.test(n)) return 'High Row';
  if (/pulley/.test(n)) return 'Cable Row';
  return 'Machine Row';
}

function kneeAndHip(n) {
  if (/leg press|leg-press/.test(n)) return ['Leg Press'];
  if (/hack squat/.test(n)) return ['Hack Squat'];
  if (/pendulum/.test(n)) return ['Pendulum Squat'];
  if (/belt squat/.test(n)) return ['Belt Squat'];
  const out = [];
  if (/squat/.test(n)) out.push('Machine Squat');
  if (/lunge/.test(n)) out.push('Lunge');
  return out;
}

function legCurl(n) {
  if (/nordic/.test(n)) return 'Nordic Curl';
  if (/glute and ham|glute ham|glute-ham/.test(n)) return 'Glute-Ham Raise';
  if (/seated/.test(n)) return 'Seated Leg Curl';
  if (/lying|prone/.test(n)) return 'Prone Leg Curl';
  if (/kneeling/.test(n)) return 'Kneeling Leg Curl';
  if (/standing/.test(n)) return 'Standing Leg Curl';
  return 'Leg Curl';
}

function chestPress(n) {
  const out = [];
  if (/declin/.test(n)) out.push('Decline Machine Press');
  if (/flat/.test(n) || !out.length) out.push(/converg/.test(n) ? 'Converging Chest Press' : 'Flat Machine Chest Press');
  return out;
}

function triceps(n) {
  if (/pushdown|pulley/.test(n)) return 'Tricep Pushdown';
  if (/\bdips?\b/.test(n)) return 'Machine Dip';
  if (/french press|overhead/.test(n)) return 'Machine Overhead Triceps Extension';
  return 'Machine Triceps Extension';
}

function hipExtension(n) {
  if (/hip thrust|thruster|glute drive|glute bridge/.test(n)) return ['Hip Thrust'];
  if (/reverse hyper/.test(n)) return ['Reverse Hyperextension'];
  if (/deadlift/.test(n)) return ['Machine Deadlift'];
  if (/glute|gluteus|rear kick/.test(n)) return ['Machine Hip Extension'];
  return [];
}

function calf(n, key) {
  if (key === 'calf') return /leg press|calf press/.test(n) ? 'Leg-Press Calf Raise' : 'Calf Raise';
  if (/seated|tilt seat/.test(n)) return 'Seated Calf Raise';
  if (/standing/.test(n)) return 'Standing Calf Raise';
  return 'Calf Raise';
}

// If the name gives nothing more specific, the action alone decides.
const BY_ACTION = { 'knee-and-hip-extension': 'Machine Squat', 'hip-extension': 'Machine Hip Extension' };

/**
 * One mode → { names: [exercise], basis: 'name'|'action', flags: [{ code, text }] }.
 * `n` is the machine name in lower case; `key` the mode key.
 */
export function exercisesForMode(mode, n) {
  const key = mode.key;
  const s = sig(mode.atoms);
  const flags = [];
  let names;
  switch (s) {
    case 'knee-and-hip-extension':
      names = key === 'leg-press' ? ['Leg Press'] : key === 'squat' ? ['Machine Squat'] : key === 'deadlift' ? ['Machine Deadlift'] : kneeAndHip(n);
      break;
    case 'elbow-flexion+scapular-retraction+shoulder-extension':
    case 'elbow-flexion+scapular-retraction+shoulder-horizontal-extension':
    case 'elbow-flexion+scapular-retraction+shoulder-extension+shoulder-horizontal-extension':
      names = [rowType(n)];
      break;
    case 'elbow-flexion+shoulder-adduction+shoulder-extension':
      names = [key === 'chin' ? (assisted(n) ? 'Assisted Pull-Up' : 'Pull-Up') : 'Lat Pulldown'];
      break;
    case 'elbow-flexion':
    case 'elbow-flexion+forearm-supination':
      names = [/preacher/.test(n) ? 'Machine Preacher Curl' : 'Machine Biceps Curl'];
      break;
    case 'knee-flexion':
      names = [legCurl(n)];
      break;
    case 'elbow-extension+shoulder-horizontal-flexion':
      if (/pek dek|pec dek|pec deck/.test(n)) {
        names = ['Pec Deck'];
        flags.push({ code: 'name-action-mismatch', text: 'The name says pec deck (a fly), but the recorded action includes elbow extension (a press).' });
      } else names = chestPress(n);
      break;
    case 'elbow-extension':
    case 'elbow-extension+forearm-pronation':
      if (key === 'dip') names = [assisted(n) ? 'Assisted Dip' : /dip machine/.test(n) ? 'Machine Dip' : 'Dip'];
      else if (key === 'triceps') names = ['Machine Triceps Extension'];
      else if (key === 'pushdown') names = ['Tricep Pushdown'];
      else names = [triceps(n)];
      break;
    case 'elbow-extension+shoulder-abduction+shoulder-flexion':
      names = ['Machine Shoulder Press'];
      break;
    case 'elbow-extension+shoulder-flexion+shoulder-horizontal-flexion':
      names = key === 'chest' || /multi ?-?press|multipurpose|total press/.test(n)
        ? ['Flat Machine Chest Press', 'Incline Machine Press'] : ['Incline Machine Press'];
      break;
    case 'trunk-flexion': names = ['Machine Abdominal Crunch']; break;
    case 'trunk-extension': names = ['Back Extension']; break;
    case 'trunk-rotation': names = ['Rotary Torso']; break;
    case 'hip-extension':
      names = key === 'hip-extension' ? ['Machine Hip Extension'] : hipExtension(n);
      break;
    case 'ankle-plantar-flexion': names = [calf(n, key)]; break;
    case 'knee-extension': names = [/reclin/.test(n) ? 'Reclined Leg Extension' : 'Leg Extension']; break;
    case 'shoulder-horizontal-flexion':
      if (key !== 'pec' && /revers|rear/.test(n)) {
        names = ['Reverse Pec Deck'];
        flags.push({ code: 'name-action-mismatch', text: 'The name says reverse fly (rear delts), but the recorded action is shoulder horizontal flexion — the chest movement. Check the source.' });
      } else names = ['Pec Deck'];
      break;
    case 'shoulder-horizontal-extension': names = ['Reverse Pec Deck']; break;
    case 'shoulder-abduction': names = ['Machine Lateral Raise']; break;
    case 'hip-abduction': names = ['Hip Abduction Machine']; break;
    case 'hip-adduction': names = ['Hip Adduction Machine']; break;
    case 'hip-flexion': names = ['Machine Hip Flexion']; break;
    case 'shoulder-extension': names = ['Machine Pullover']; break;
    case 'scapular-elevation': names = ['Machine Shrug']; break;
    case 'ankle-dorsiflexion': names = ['Tibialis Raise']; break;
    case 'cervical-flexion': case 'cervical-extension': case 'cervical-lateral-flexion': names = ['Neck Machine']; break;
    case 'wrist-flexion': names = ['Wrist Curl']; break;
    case 'wrist-extension': names = ['Wrist Extension']; break;
    case 'forearm-supination': names = ['Wrist Supination']; break;
    case 'forearm-pronation': names = ['Wrist Pronation']; break;
    case 'finger-flexion':
      names = ['Finger Curl'];
      if (!/forearm|finger/.test(n)) flags.push({ code: 'matched-by-action', text: 'Matched to Finger Curl by its recorded action (finger flexion); the name doesn\'t name an exercise.' });
      break;
    case 'shoulder-internal-rotation': names = ['Machine Internal Rotation']; break;
    case 'shoulder-external-rotation': names = ['Machine External Rotation']; break;
    default:
      throw new Error(`No exercise rule for the action combination "${s}"`);
  }
  let basis = 'name';
  if (!names.length) {
    names = [BY_ACTION[s]];
    basis = 'action';
    flags.push({ code: 'matched-by-action', text: `The name doesn't say which exercise; matched to ${BY_ACTION[s]} by its recorded action.` });
  }
  return { names, basis, flags };
}

// Rows whose recorded modes are a pair (pulldown + row, chin + dip) while the
// machine's name points to only one of them: keep the named one.
const PAIRS = [
  { modes: ['pulldown', 'row'], test: { pulldown: /\blat\b|pull ?-?down/, row: /\brow\b|pulley/ } },
  { modes: ['chin', 'dip'], test: { chin: /\bchin/, dip: /\bdips?\b/ } },
];

/** Which recorded modes the machine's name supports; flags the others. */
export function modesInName(modes, n) {
  const keys = modes.map((m) => m.key).sort().join('+');
  const pair = PAIRS.find((p) => [...p.modes].sort().join('+') === keys);
  if (!pair) return { keep: modes.map((m) => m.key), flags: [] };
  const named = pair.modes.filter((k) => pair.test[k].test(n));
  if (!named.length || named.length === pair.modes.length) return { keep: pair.modes.slice(), flags: [] };
  const dropped = pair.modes.filter((k) => !named.includes(k));
  return {
    keep: named,
    flags: dropped.map((k) => ({ code: 'mode-not-in-name', text: `The recorded action also lists a ${k} mode, which the machine's name doesn't mention; it isn't matched to an exercise.` })),
  };
}

// Exercises the name mentions that the recorded action doesn't cover. They
// are offered (the name says so) but carry no derived muscles.
const NAME_ONLY = [
  { re: /\bbicep \/ tricep\b/, exercise: 'Machine Triceps Extension', text: 'The name includes a triceps mode, but the recorded action is elbow flexion only.' },
  { re: /leg raise/, exercise: 'Hanging Leg Raise', text: 'The name includes leg raises, which the recorded action doesn\'t cover.' },
  { re: /glute ham \/ reverse hyper/, exercise: 'Glute-Ham Raise', text: 'The name includes a glute-ham raise; only hip extension is recorded, not its knee flexion.' },
  { re: /high pull/, exercise: null, text: 'The name includes a high pull, which the recorded action doesn\'t cover.' },
];

export function nameOnly(n) {
  return NAME_ONLY.filter((r) => r.re.test(n));
}

// Machines with no recorded action.
const STATION_RULES = [
  [/smith/, 'smith'],
  [/pulley|cable|cross ?over|functional train|freedom trainer|\bhlp\b|kinesis/, 'cable'],
  [/station|multi gym|multi-station|jungle|home gym|^inside$|^unica$|pwr play|synrgy|multipower|power rack/, 'multi'],
];

export function stationType(n) {
  const hit = STATION_RULES.find(([re]) => re.test(n));
  return hit ? hit[1] : null;
}

export const stationInfo = (type) => STATIONS[type];
