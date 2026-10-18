// The machine database: rows from the CSV → machines with derived exercises,
// muscles and review flags, plus lookups for the UI. Pure (no DOM, no storage).

import { fields, assignIds } from './source.js';
import { ATOMS, parseAction } from './actions.js';
import { indexSpecification, mapMode, modeGroups, entryActionId } from './muscles.js';
import { parseProfile, overlapProfile, sourceKind, PROFILE_LABELS } from './profile.js';
import { exercisesForMode, modesInName, nameOnly, stationType, stationInfo } from './match.js';
import { NEW_EXERCISES, FAMILIES, STATIONS } from '../data/exercises.js';

export const UNLISTED = 'Not in your muscle list';
export const UNRECORDED = 'No muscle action recorded';

const FLAG_TEXT = {
  'no-action': 'No muscle action recorded, so no muscles are derived.',
  'no-model': 'No model code recorded.',
  'no-source': 'No resistance-profile source recorded.',
  'plane-depends-on-grip': 'The recorded action says the movement plane depends on grip; targets follow the plane it records.',
  'depends-on-setup': 'The recorded action says the shoulder\'s contribution depends on setup; only the elbow action is mapped.',
  'multi-station': 'Multi-station: which stations it includes isn\'t recorded, so it is offered only as a possible match for cable exercises.',
  unmatched: 'No muscle action recorded and the name doesn\'t identify an exercise, so it isn\'t matched to one. It can still be found and added from the Machines tab.',
  'profile-setting': 'The resistance profile depends on a setting; it can\'t be compared with other machines.',
};

/** Overlap-catalogue record id for one machine mode. */
export function recordId(machineId, modeKey) {
  if (modeKey === 'main') return machineId;
  if (modeKey == null) return `${machineId}#unrecorded`;
  return `${machineId}#${modeKey}`;
}

function flag(code, text) { return { code, text: text || FLAG_TEXT[code] }; }

/** One row → a machine (everything except cross-row checks). */
function buildMachine(row, id, sourceRow, spec) {
  const f = fields(row);
  const n = f.machine.toLowerCase();
  const action = parseAction(f.action);
  const profile = parseProfile(f.profile);
  const source = sourceKind(f.sourceType);
  const flags = [];

  const modes = action.modes.map((m) => {
    const mapped = mapMode(m, spec);
    return {
      key: m.key, label: m.label, atoms: m.atoms, conditional: m.conditional, notes: m.notes,
      targets: mapped.targets, candidates: mapped.candidates, unmapped: mapped.unmapped,
      groups: modeGroups(mapped),
    };
  });
  for (const m of action.modes) for (const code of m.flags) if (!flags.some((x) => x.code === code)) flags.push(flag(code));

  const exercises = [];
  const add = (name, mode, basis) => { if (!exercises.some((e) => e.name === name && e.mode === mode)) exercises.push({ name, mode, basis }); };
  let station = null;
  if (action.recorded) {
    const { keep, flags: modeFlags } = modesInName(action.modes, n);
    flags.push(...modeFlags);
    for (const m of action.modes) {
      if (!keep.includes(m.key)) continue;
      const r = exercisesForMode(m, n);
      r.names.forEach((name) => add(name, m.key, r.basis));
      for (const fl of r.flags) if (!flags.some((x) => x.code === fl.code && x.text === fl.text)) flags.push(fl);
    }
    for (const extra of nameOnly(n)) {
      if (extra.exercise) add(extra.exercise, null, 'name-only');
      flags.push(flag('name-mentions-unrecorded', extra.text));
    }
  } else {
    flags.push(flag('no-action'));
    station = stationType(n);
    if (station) {
      const info = stationInfo(station);
      (info.exercises || []).forEach((name) => add(name, null, info.basis));
      if (station === 'multi') flags.push(flag('multi-station'));
    } else flags.push(flag('unmatched'));
  }

  if (!f.model) flags.push(flag('no-model'));
  if (!f.sourceType) flags.push(flag('no-source'));
  if (['SELECTABLE', 'ADJUSTABLE', 'MODE-DEPENDENT', 'CONFIGURATION-DEPENDENT'].includes(profile.category)) flags.push(flag('profile-setting'));

  const groups = [...new Set(modes.flatMap((m) => m.groups))];
  if (modes.some((m) => m.unmapped.length)) groups.push(UNLISTED);
  if (!action.recorded) groups.push(UNRECORDED);

  return {
    id, row: sourceRow,
    brand: f.brand, line: f.line, name: f.machine, model: f.model,
    action: f.action, profileText: f.profile, setup: f.setup, sourceType: f.sourceType, sourceUrl: f.sourceUrl,
    profile, source, recorded: action.recorded, modes, exercises, station, groups, flags,
  };
}

/** Flags that need the whole file: shared model codes and shared names. */
function crossRowFlags(machines) {
  const byModel = new Map(), byName = new Map();
  for (const m of machines) {
    if (m.model) { const k = `${m.brand}|${m.model}`; byModel.set(k, (byModel.get(k) || []).concat(m)); }
    const k = `${m.brand}|${m.line}|${m.name.toLowerCase()}`;
    byName.set(k, (byName.get(k) || []).concat(m));
  }
  for (const group of byModel.values()) if (group.length > 1) for (const m of group) {
    m.flags.push(flag('shared-model', `Model ${m.model} is shared with: ${group.filter((x) => x !== m).map((x) => x.name).join(', ')}. Kept as separate machines.`));
  }
  for (const group of byName.values()) if (group.length > 1) for (const m of group) {
    m.flags.push(flag('shared-name', `${group.length} machines share this name with different models (${group.map((x) => x.model || 'no model').join(', ')}). Kept as separate machines.`));
  }
}

const fold = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function createMachineDb(rows, specEntries) {
  const spec = indexSpecification(specEntries);
  const ids = assignIds(rows);
  const machines = rows.map((row, i) => buildMachine(row, ids[i], i + 2, spec));
  crossRowFlags(machines);
  const byId = new Map(machines.map((m) => [m.id, m]));

  // Search text: identity, exercises, action, profile and muscles.
  const text = new Map(machines.map((m) => [m.id, fold([
    m.brand, m.line, m.name, m.model, m.action, m.profileText, m.setup,
    ...m.exercises.map((e) => e.name), ...m.groups,
    ...m.modes.flatMap((md) => md.targets.map((t) => t.entry.muscle)),
    m.station ? STATIONS[m.station].label : '',
  ].join(' '))]));

  const familyOf = new Map();
  for (const f of FAMILIES) for (const name of f.exercises) familyOf.set(name, f);

  /** Machines for one exercise: exact matches, then the same movement family, then stations that may support it. */
  function forExercise(name) {
    const exact = [], related = [], stations = [];
    const fam = familyOf.get(name);
    for (const m of machines) {
      const own = m.exercises.filter((e) => e.name === name);
      if (own.length) {
        for (const e of own) (e.basis === 'station-unconfirmed' ? stations : exact).push({ machine: m, mode: e.mode, basis: e.basis });
        continue;
      }
      if (m.station) {
        const info = STATIONS[m.station];
        if ((info.related || []).includes(name)) stations.push({ machine: m, mode: null, basis: 'station-related' });
        continue;
      }
      if (fam) {
        const e = m.exercises.find((x) => x.basis !== 'name-only' && fam.exercises.includes(x.name));
        if (e) related.push({ machine: m, mode: e.mode, basis: 'family', via: e.name });
      }
    }
    return { exact, related, stations, family: fam || null };
  }

  /** Filtered search. text matches every word; brand/group/exercise are exact. */
  function search({ text: q = '', brand = '', group = '', exercise = '' } = {}) {
    const words = fold(q).split(/\s+/).filter(Boolean);
    return machines.filter((m) =>
      (!brand || m.brand === brand) &&
      (!group || m.groups.includes(group)) &&
      (!exercise || (exercise.startsWith('station:') ? m.station === exercise.slice(8) : exercise === 'unmatched' ? !m.station && !m.exercises.length : m.exercises.some((e) => e.name === exercise))) &&
      words.every((w) => text.get(m.id).includes(w)));
  }

  const count = (list) => [...list.reduce((acc, k) => acc.set(k, (acc.get(k) || 0) + 1), new Map())]
    .map(([name, n]) => ({ name, count: n }));

  /** Filter options with counts. */
  function options() {
    const groupOrder = [...new Set(specEntries.map((e) => e.group)), UNLISTED, UNRECORDED];
    const exCount = count(machines.flatMap((m) => [...new Set(m.exercises.filter((e) => e.basis !== 'station' && e.basis !== 'station-unconfirmed').map((e) => e.name))]));
    return {
      brands: count(machines.map((m) => m.brand)).sort((a, b) => a.name.localeCompare(b.name)),
      groups: count(machines.flatMap((m) => m.groups)).sort((a, b) => groupOrder.indexOf(a.name) - groupOrder.indexOf(b.name)),
      exercises: exCount.sort((a, b) => a.name.localeCompare(b.name)),
      stations: Object.keys(STATIONS).map((k) => ({ key: k, name: STATIONS[k].label, count: machines.filter((m) => m.station === k).length })),
      unmatched: machines.filter((m) => !m.station && !m.exercises.length).length,
    };
  }

  /** Overlap-catalogue records: one per machine mode (plus "unrecorded"). */
  function records() {
    const out = [];
    for (const m of machines) {
      const equipment = { id: m.id, name: `${m.brand} ${m.name}`, category: m.station === 'cable' ? 'cable' : m.station ? 'other' : 'machine' };
      const base = { equipment, notes: m.setup, machine: m.id };
      const label = `${m.brand} ${m.name}${m.model ? ` (${m.model})` : ''}`;
      for (const md of m.modes) {
        out.push({
          ...base,
          id: recordId(m.id, md.key),
          name: md.label ? `${label} · ${md.label}` : label,
          variant: md.label ? { id: md.key, name: md.label } : null,
          contributions: md.targets.map((t) => ({
            target: t.entry.id,
            action: entryActionId(t.entry),
            profile: overlapProfile(m.profile),
            profileDetail: m.profileText,
            rom: null,
            setup: { movement: ATOMS[t.atom], ...Object.fromEntries(t.contextKeys.map((k) => [k, null])) },
          })),
          candidates: md.candidates.map((c) => ({ target: c.entry.id, group: c.entry.group, atom: c.atom, label: ATOMS[c.atom], kind: c.kind, reason: c.reason })),
          unmapped: md.unmapped.map((a) => ATOMS[a]),
        });
      }
      if (!m.modes.length || m.exercises.some((e) => e.mode == null)) {
        out.push({
          ...base, id: recordId(m.id, null), name: label, variant: null, contributions: [], candidates: [], unmapped: [],
          unrecorded: true, unrecordedReason: m.recorded ? 'the recorded action doesn\'t cover this exercise' : 'no muscle action recorded for this machine',
        });
      }
    }
    return out;
  }

  /** Machines matched to an exercise (exact matches and cable/Smith stations), memoised. */
  let counts = null;
  function exactCount(name) {
    if (!counts) {
      counts = new Map();
      for (const m of machines) {
        for (const n of new Set(m.exercises.filter((e) => e.basis !== 'station-unconfirmed').map((e) => e.name))) counts.set(n, (counts.get(n) || 0) + 1);
      }
    }
    return counts.get(name) || 0;
  }

  /** Small copy kept on logged exercises, so history reads even if the file changes. */
  function snapshot(m, mode) {
    const md = m.modes.find((x) => x.key === mode);
    return { id: m.id, brand: m.brand, line: m.line, name: m.name, model: m.model, profile: m.profileText, mode: mode ?? null, modeLabel: md ? md.label : null };
  }

  return {
    machines, byId, get: (id) => byId.get(id) || null,
    forExercise, search, options, records, snapshot, exactCount,
    familyOf: (name) => familyOf.get(name) || null,
    exerciseNames: () => Object.keys(NEW_EXERCISES),
    newExercise: (name) => NEW_EXERCISES[name] || null,
    profileLabel: (p) => PROFILE_LABELS[p.category] || p.raw,
    spec,
  };
}
