// Coverage — kept separate from overlap. A planned target is a muscle-action
// entry from the specification (region + its action). Coverage only asks
// whether the selections train that region with that action; it never
// requires a particular resistance profile and never rewards variety.

import { actionId } from './catalogue.js';

/** Target + action pairs the linked selections contribute (deduplicated). */
function contributed(selections, cat) {
  const out = new Map(); // `${target}|${action}` → { target, action, keys: Set }
  const actionless = new Set(); // targets with a contribution missing its action
  for (const sel of selections) {
    const rec = sel.catalogId ? cat.get(sel.catalogId) : null;
    if (!rec) continue;
    for (const c of rec.contributions) {
      if (!c.action) { actionless.add(c.target); continue; }
      const k = `${c.target}|${c.action}`;
      if (!out.has(k)) out.set(k, { target: c.target, action: c.action, keys: new Set() });
      out.get(k).keys.add(sel.key);
    }
  }
  return { pairs: out, actionless };
}

/**
 * Coverage of one session (or any set of selections).
 *   planned: muscle-action entry ids the user intends to train ([] = none set)
 * → { planned: bool, covered, missing, undetermined, observed }
 * Without planned targets only `observed` is filled: what the selections
 * cover, with no claim that the session is complete or incomplete.
 */
export function sessionCoverage(selections, cat, planned = []) {
  const { pairs, actionless } = contributed(selections, cat);
  const unknownSelections = selections.filter((s) => !(s.catalogId && cat.get(s.catalogId)));
  const observed = [...pairs.values()]
    .map((p) => ({ target: cat.entryById.get(p.target), action: p.action, actionLabel: cat.actionLabel(p.action), keys: [...p.keys] }))
    .sort((a, b) => a.target.order - b.target.order);
  if (!planned.length) return { planned: false, covered: [], missing: [], undetermined: [], observed };

  const covered = [], missing = [], undetermined = [];
  for (const id of planned) {
    const entry = cat.entryById.get(id);
    if (!entry) continue;
    const hit = pairs.get(`${id}|${actionId(entry.muscleAction)}`);
    if (hit) covered.push({ target: entry, keys: [...hit.keys] });
    else if (unknownSelections.length || actionless.has(id)) {
      undetermined.push({ target: entry, reason: actionless.has(id) ? 'a selection lists this region without its action' : `${unknownSelections.length} selection${unknownSelections.length === 1 ? ' is' : 's are'} not in the catalogue` });
    } else missing.push({ target: entry });
  }
  return { planned: true, covered, missing, undetermined, observed };
}

/**
 * Weekly planned coverage across a split. Weekly frequency is a separate
 * question from within-session overlap: the same exercise on two days is
 * simply two sessions of coverage.
 *   sessions: [{ id, name, selections, planned: [entry ids] }]
 *   perWeek:  { [session id]: sessions in a typical week }
 * → [{ target, planned, sessions: [{ id, name, perWeek }], perWeek, status }]
 *   status: 'covered' | 'missing' | 'undetermined' | 'observed' (not planned)
 */
export function weeklyCoverage(sessions, cat, perWeek = {}) {
  const rows = new Map();
  const row = (entry) => {
    if (!rows.has(entry.id)) rows.set(entry.id, { target: entry, planned: false, sessions: [], perWeek: 0, undetermined: false });
    return rows.get(entry.id);
  };
  for (const s of sessions) {
    const cov = sessionCoverage(s.selections, cat, s.planned || []);
    const n = perWeek[s.id] ?? 0;
    for (const id of s.planned || []) { const e = cat.entryById.get(id); if (e) row(e).planned = true; }
    // Covered planned targets, plus anything else observed (by region + action).
    const hits = new Set(cov.covered.map((c) => c.target.id));
    for (const o of cov.observed) if (o.action === actionId(o.target.muscleAction)) hits.add(o.target.id);
    for (const id of hits) {
      const r = row(cat.entryById.get(id));
      r.sessions.push({ id: s.id, name: s.name, perWeek: n });
      r.perWeek += n;
    }
    for (const u of cov.undetermined) row(u.target).undetermined = true;
  }
  return [...rows.values()]
    .map((r) => ({ ...r, status: r.sessions.length ? (r.planned ? 'covered' : 'observed') : r.undetermined ? 'undetermined' : 'missing' }))
    .sort((a, b) => a.target.order - b.target.order);
}
