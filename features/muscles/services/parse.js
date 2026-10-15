// Parsing for the muscle-action source file (Muscle_Actions_Updated_Profiles.csv).
// Pure functions shared by the generator (scripts/build-muscle-db.mjs) and the
// tests. Strict on purpose: anything that doesn't match the known layout or
// profile wording throws instead of being guessed at.

export const HEADER = ['MUSCLE', 'RESISTANCE PROFILE', 'MUSCLE ACTION'];
export const NOTES_HEADING = 'Update notes';

// Profile types exactly as written in the source. 'IRRELEVANT', 'N/A' and
// 'Not specified' are three different statements and stay distinct.
export const PROFILE_TYPES = ['ASCENDING', 'DESCENDING', 'MID-RANGE', 'IRRELEVANT', 'N/A', 'Not specified'];

/** RFC 4180 CSV → array of string arrays (quotes, escaped quotes, CRLF). */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\r' && src[i + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; }
    else if (ch === '\n' || ch === '\r') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (quoted) throw new Error('CSV ends inside a quoted field');
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** URL-safe id from the muscle name, e.g. 'latissimus-dorsi-upper'. */
export function slug(name) {
  return name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Split a resistance-profile cell into its parts without changing any text.
 *   'IRRELEVANT (knee flexion)'                → type + context
 *   'ASCENDING; heaviest at 25–0° hip flexion' → type + qualification (+ angle range, reference)
 *   'IRRELEVANT; ASCENDING preferred'          → type + qualification (+ preferred)
 *   'ASCENDING; 30–70° range'                  → angle range with no stated reference
 * Every returned string is an exact substring of the input, and the input
 * can be rebuilt from them (see rebuildProfile).
 */
export function parseProfile(raw) {
  const m = /^(ASCENDING|DESCENDING|MID-RANGE|IRRELEVANT|N\/A|Not specified)(?: \(([^()]+)\))?(?:; (.+))?$/.exec(raw);
  if (!m) throw new Error(`Unrecognised resistance profile: "${raw}"`);
  const [, type, context = null, qualification = null] = m;
  const out = { type, context, qualification, preferred: null, angleRange: null, angleStart: null, angleEnd: null, angleReference: null };
  if (qualification) {
    let q;
    if ((q = /^(ASCENDING|DESCENDING|MID-RANGE) preferred$/.exec(qualification))) out.preferred = q[1];
    else if ((q = /^heaviest at ((\d+)–(\d+)°) (.+)$/.exec(qualification))) {
      out.angleRange = q[1]; out.angleStart = Number(q[2]); out.angleEnd = Number(q[3]); out.angleReference = q[4];
    } else if ((q = /^((\d+)–(\d+)°) range$/.exec(qualification))) {
      // The source states no joint / angle convention for this range.
      out.angleRange = q[1]; out.angleStart = Number(q[2]); out.angleEnd = Number(q[3]);
    } else throw new Error(`Unrecognised profile qualification: "${qualification}"`);
  }
  if (rebuildProfile(out) !== raw) throw new Error(`Profile parse is lossy for "${raw}"`);
  return out;
}

export function rebuildProfile(p) {
  return p.type + (p.context ? ` (${p.context})` : '') + (p.qualification ? `; ${p.qualification}` : '');
}

/**
 * The whole file → { entries, notes }. Layout: header row, data rows until
 * the first blank row, then the 'Update notes' heading and note rows
 * (topic, status, detail). Notes are documentation, never entries.
 */
export function parseSource(text) {
  const rows = parseCsv(text);
  const cells = (r) => r.map((c) => c ?? '');
  if (rows[0].join('\u0001') !== HEADER.join('\u0001')) throw new Error(`Unexpected header: ${JSON.stringify(rows[0])}`);
  const entries = [];
  let i = 1;
  for (; i < rows.length; i++) {
    const r = cells(rows[i]);
    if (r.every((c) => c === '')) break;
    if (r.length !== 3 || r.some((c) => c === '')) throw new Error(`Row ${i + 1} is not a complete entry: ${JSON.stringify(r)}`);
    const [muscle, resistanceProfile, muscleAction] = r;
    const name = /^(.+?) — (.+)$/.exec(muscle);
    if (!name) throw new Error(`Row ${i + 1}: muscle name has no "Group — Region" form: "${muscle}"`);
    entries.push({
      id: slug(muscle),
      order: entries.length + 1,
      sourceRow: i + 1,
      muscle,
      group: name[1],
      region: name[2],
      resistanceProfile,
      profile: parseProfile(resistanceProfile),
      muscleAction,
    });
  }
  // Skip blank rows, then expect the notes heading.
  while (i < rows.length && cells(rows[i]).every((c) => c === '')) i++;
  const notes = { title: null, items: [] };
  if (i < rows.length) {
    const h = cells(rows[i]);
    if (h[0] !== NOTES_HEADING || h.slice(1).some((c) => c !== '')) throw new Error(`Expected "${NOTES_HEADING}" heading at row ${i + 1}`);
    notes.title = h[0];
    for (i++; i < rows.length; i++) {
      const r = cells(rows[i]);
      if (r.every((c) => c === '')) continue;
      if (r.length !== 3) throw new Error(`Note row ${i + 1} should have 3 cells`);
      notes.items.push({ topic: r[0], status: r[1], detail: r[2], sourceRow: i + 1 });
    }
  }
  const ids = new Set(entries.map((e) => e.id));
  if (ids.size !== entries.length) throw new Error('Two muscle names produce the same id');
  return { entries, notes };
}
