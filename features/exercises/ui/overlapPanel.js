// HTML for the overlap / coverage parts of the plan wizard. Pure string
// builders (no DOM), so empty states are testable in Node. Wording stays
// neutral: repeated coverage, possible overlap, different coverage,
// insufficient information — never "bad", "wasted" or "redundant".

import { analyseSession, selectionsFromRoutine, overlapLine } from '../services/overlap.js';
import { sessionCoverage, weeklyCoverage } from '../services/coverage.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const profileText = (p) => (p === 'MID-RANGE' ? 'Mid-range' : p === 'N/A' || p === 'Not specified' ? p : p.charAt(0) + p.slice(1).toLowerCase());
const list = (names) => names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

const NOTE = 'A planning aid: repeated coverage means selections train the same target in the same way. It is not a judgement of any exercise or of the workout.';

/** Catalogue select for one planner row (nothing when the catalogue is empty). */
export function recordSelectHtml(x, cat, attrs) {
  if (!cat.records.length) return '';
  const opts = cat.records.map((r) => `<option value="${esc(r.id)}"${r.id === x.catalogId ? ' selected' : ''}>${esc(r.name)}${r.variant ? ` · ${esc(r.variant.name)}` : ''}</option>`).join('');
  const missing = x.catalogId && !cat.get(x.catalogId) ? `<option value="${esc(x.catalogId)}" selected>Missing record (${esc(x.catalogId)})</option>` : '';
  return `<label class="ov-rec"><span>Catalogue record</span><select class="tw-in" data-field="xcat" ${attrs}><option value="">Not linked</option>${missing}${opts}</select></label>`;
}

/** Targets, actions, profiles and setup for a linked record. */
export function recordDetailHtml(x, cat) {
  const rec = x.catalogId ? cat.get(x.catalogId) : null;
  if (!rec) return '';
  const eq = rec.equipment ? `${esc(rec.equipment.name)}${rec.variant ? ` · ${esc(rec.variant.name)}` : ''}` : '';
  return `<div class="ov-det">
    ${eq ? `<div class="ov-det-eq">${eq}</div>` : ''}
    <ul>${rec.contributions.map((c) => {
      const t = cat.entryById.get(c.target);
      const setup = Object.entries(c.setup || {}).map(([k, v]) => `${esc(k)}: ${esc(v)}`);
      if (c.rom) setup.unshift(`${esc(c.rom.joint)} ${esc(c.rom.start)}–${esc(c.rom.end)}°`);
      return `<li><b>${esc(t ? t.muscle : c.target)}</b><span>${c.action ? esc(cat.actionLabel(c.action)) : 'Action not recorded'} · ${esc(profileText(c.profile || 'Not specified'))}${setup.length ? ` · ${setup.join(' · ')}` : ''}</span></li>`;
    }).join('')}</ul>
    ${rec.notes ? `<p class="ov-det-n">${esc(rec.notes)}</p>` : ''}
  </div>`;
}

/** Optional intended targets for a session, grouped by muscle. */
export function targetsPickerHtml(routine, entries) {
  const chosen = new Set(routine.targets || []);
  const groups = [...new Set(entries.map((e) => e.group))];
  return `<details class="ov-tp"${Array.isArray(routine.targets) ? ' open' : ''}>
    <summary>Intended targets <span>${chosen.size ? `${chosen.size} selected` : 'Optional'}</span></summary>
    <p class="tw-p small">Pick what this session is meant to train. Coverage is checked against these; nothing else is expected.</p>
    ${groups.map((g) => `<fieldset><legend>${esc(g)}</legend>${entries.filter((e) => e.group === g).map((e) =>
      `<label><input type="checkbox" data-field="rtarget" data-id="${esc(routine.id)}" value="${esc(e.id)}"${chosen.has(e.id) ? ' checked' : ''}><span>${esc(e.region)}<small>${esc(e.muscleAction)}</small></span></label>`).join('')}</fieldset>`).join('')}
  </details>`;
}

function possibleHtml(p) {
  return `<li class="ov-f possible"><b>Possible overlap</b> <span>${esc(p.aName)} and ${esc(p.bName)}</span><small>${esc(p.reasons.join('; '))}</small></li>`;
}

function targetHtml(t, label) {
  const shared = t.groups.filter((g) => g.keys.length > 1).map((g) => {
    const p = g.parts.map((x) => `${label(x.action)}${t.spec.profileMatters ? ` · ${profileText(x.profile)}` : ''}`).join(' + ');
    const rv = t.repeatedPairs.filter((q) => q.reviewed && g.keys.includes(q.a) && g.keys.includes(q.b));
    const why = rv.length
      ? `Marked as the same coverage of ${t.target.muscle} in a reviewed equivalence: ${rv.map((q) => q.reasons.join('; ')).join('; ')}`
      : `All train ${t.target.muscle} with ${p}${t.spec.profileMatters ? '' : ' (the specification treats profile as irrelevant or N/A here)'}; recorded setup and angle details match.`;
    return `<li class="ov-f same"><b>Repeated coverage</b> <span>${esc(list(g.names))}</span><small>${esc(why)}</small></li>`;
  });
  const possible = t.possiblePairs.map(possibleHtml);
  const na = t.notAssessed.map((x) => `<li class="ov-f na"><b>Insufficient information</b> <span>${esc(x.name)}</span><small>${esc(x.reasons.join('; '))}</small></li>`);
  const single = t.n === 1 ? '<li class="ov-f info"><small>One assessable selection: 0% overlap, which says nothing about whether coverage is complete.</small></li>' : '';
  const distinct = t.n > 1 && !shared.length && !possible.length ? '<li class="ov-f diff"><b>Different coverage</b><small>Each selection covers this target differently.</small></li>' : '';
  return `<div class="ov-t">
    <div class="ov-t-h"><span>${esc(t.target.muscle)}</span><b class="${t.n ? (t.repeated ? 'rep' : '') : 'na'}">${esc(overlapLine(t))}</b></div>
    ${t.notAssessed.length && t.n ? `<div class="ov-t-m">${t.notAssessed.length} selection${t.notAssessed.length === 1 ? '' : 's'} could not be assessed</div>` : ''}
    <ul>${shared.join('')}${possible.join('')}${distinct}${single}${na.join('')}</ul>
  </div>`;
}

function coverageHtml(cov) {
  const chips = (rows, cls) => rows.map((r) => `<span class="ov-c ${cls}" title="${esc(r.reason || r.target.muscleAction)}">${esc(r.target.muscle)}</span>`).join('');
  if (!cov.planned) {
    return `<div class="ov-cov"><div class="ov-sub">Observed coverage</div>
      ${cov.observed.length ? `<div class="ov-chips">${cov.observed.map((o) => `<span class="ov-c obs" title="${esc(o.actionLabel)}">${esc(o.target.muscle)} · ${esc(o.actionLabel)}</span>`).join('')}</div>` : '<p class="tw-p small">Nothing linked yet.</p>'}
      <p class="tw-p small">No intended targets set, so this shows what the selections cover, not whether the session is complete.</p></div>`;
  }
  return `<div class="ov-cov"><div class="ov-sub">Coverage of intended targets</div>
    ${cov.covered.length ? `<div class="ov-cl">Covered</div><div class="ov-chips">${chips(cov.covered, 'ok')}</div>` : ''}
    ${cov.missing.length ? `<div class="ov-cl">Missing</div><div class="ov-chips">${chips(cov.missing, 'miss')}</div>` : ''}
    ${cov.undetermined.length ? `<div class="ov-cl">Cannot be determined</div><div class="ov-chips">${chips(cov.undetermined, 'unk')}</div>` : ''}
  </div>`;
}

/** Overlap + coverage for one session, shown under its planner table. */
export function sessionPanelHtml(routine, cat) {
  const selections = selectionsFromRoutine(routine);
  if (!cat.records.length) {
    return `<div class="ov ov-empty"><div class="ov-h">Overlap &amp; coverage</div>
      <p class="tw-p small">The exercise catalogue is empty. Once exercise records with their target muscles, actions, resistance profiles and setup details are added, linking your selections to them will show where they repeat coverage and what they cover.</p></div>`;
  }
  if (!selections.length) return `<div class="ov"><div class="ov-h">Overlap &amp; coverage</div><p class="tw-p small">Add exercises to see overlap and coverage.</p></div>`;
  const a = analyseSession(selections, cat);
  const cov = sessionCoverage(selections, cat, routine.targets || []);
  return `<div class="ov"><div class="ov-h">Overlap &amp; coverage</div>
    ${a.unlinked.length ? `<p class="ov-unl">${a.unlinked.length} of ${a.selections} selection${a.selections === 1 ? '' : 's'} not linked to a catalogue record, so not assessed: ${esc(a.unlinked.map((u) => u.name).join(', '))}</p>` : ''}
    ${a.targets.length ? a.targets.map((t) => targetHtml(t, cat.actionLabel)).join('') : '<p class="tw-p small">Insufficient information: no linked selections to compare.</p>'}
    ${coverageHtml(cov)}
    <p class="ov-note">${esc(NOTE)}</p></div>`;
}

/**
 * Review step: per-session overlap summary plus weekly planned coverage.
 * perWeek: { [routine id]: sessions in the plan's first full week }.
 */
export function planPanelHtml(plan, cat, perWeek) {
  if (!cat.records.length) return `<div class="ov ov-empty"><p class="tw-p small">Overlap and coverage analysis will appear here once the exercise catalogue has records. It is empty for now.</p></div>`;
  const sessions = plan.routines.map((r) => ({ id: r.id, name: r.name, selections: selectionsFromRoutine(r), planned: r.targets || [] }));
  const per = plan.routines.map((r) => {
    const a = analyseSession(selectionsFromRoutine(r), cat);
    const rep = a.targets.filter((t) => t.repeated);
    const pos = a.targets.filter((t) => t.possiblePairs.length);
    const bits = [];
    if (rep.length) bits.push(`Repeated coverage for ${rep.map((t) => `${t.target.muscle} (${overlapLine(t)})`).join(', ')}`);
    if (pos.length) bits.push(`${bits.length ? 'possible' : 'Possible'} overlap for ${pos.map((t) => t.target.muscle).join(', ')}`);
    if (a.unlinked.length) bits.push(`${a.unlinked.length} not linked to the catalogue, so not assessed`);
    return `<li><b>${esc(r.name)}</b><span>${a.targets.length || a.unlinked.length ? esc(bits.join(' · ') || 'Different coverage across its selections') : 'Insufficient information'}</span></li>`;
  });
  const weekly = weeklyCoverage(sessions, cat, perWeek);
  const status = { covered: 'Covered', missing: 'Missing', undetermined: 'Cannot be determined', observed: 'Observed (not planned)' };
  return `<div class="ov">
    <div class="ov-sub">Within-session overlap</div><ul class="ov-sess">${per.join('')}</ul>
    <div class="ov-sub">Weekly planned coverage</div>
    ${weekly.length ? `<div class="ov-wk"><table><thead><tr><th>Target</th><th>Sessions / week</th><th>Status</th></tr></thead><tbody>${weekly.map((w) =>
      `<tr><td>${esc(w.target.muscle)}<small>${esc(w.target.muscleAction)}</small></td><td>${w.sessions.length ? `${w.perWeek}<small>${esc(w.sessions.map((s) => s.name).join(', '))}</small>` : '–'}</td><td class="st-${w.status}">${status[w.status]}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="tw-p small">No intended targets or linked selections yet.</p>'}
    <p class="ov-note">Weekly frequency and within-session overlap are separate: the same exercise on two days is two sessions of coverage, not overlap.</p>
  </div>`;
}
