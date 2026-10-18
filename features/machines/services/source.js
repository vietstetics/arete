// Parsing for the machine database (Strength_Machines_App_Database - Machines.csv).
// Pure functions shared by the generator (scripts/build-machine-db.mjs), the
// browser module and the tests. Strict on purpose: a row that doesn't fit the
// known layout throws instead of being skipped or repaired.

import { parseCsv, slug } from '../../muscles/services/parse.js';

export const SOURCE_FILE = 'Strength_Machines_App_Database - Machines.csv';
export const COLUMNS = ['Brand', 'Line', 'Machine', 'Model', 'Muscle action', 'Resistance profile', 'Setup', 'Source type', 'RP source URL'];

/** CSV text → array of 9-string rows (header removed), in source order. */
export function parseMachineCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length || rows[0].join('\u0001') !== COLUMNS.join('\u0001')) {
    throw new Error(`Unexpected header: ${JSON.stringify(rows[0])}`);
  }
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const blank = r.every((c) => c === '');
    if (blank) {
      if (i === rows.length - 1) continue; // a trailing newline, nothing more
      throw new Error(`Row ${i + 1} is blank`);
    }
    if (r.length !== COLUMNS.length) throw new Error(`Row ${i + 1} has ${r.length} cells, expected ${COLUMNS.length}`);
    if (!r[0] || !r[2]) throw new Error(`Row ${i + 1}: Brand and Machine are required`);
    out.push(r.slice());
  }
  return out;
}

/** Row array → named fields (values exactly as in the file). */
export function fields(row) {
  const [brand, line, machine, model, action, profile, setup, sourceType, sourceUrl] = row;
  return { brand, line, machine, model, action, profile, setup, sourceType, sourceUrl };
}

/**
 * Stable ids, one per row: brand + model when that pair is unique in the
 * file; otherwise (no model, or a model code shared by several rows) brand +
 * model + machine name. Deterministic for a given file; throws if two rows
 * would still collide.
 */
export function assignIds(rows) {
  const base = (r) => `${slug(r[0])}-${slug(r[3])}`;
  const seen = new Map();
  rows.forEach((r) => { if (r[3]) seen.set(base(r), (seen.get(base(r)) || 0) + 1); });
  const ids = rows.map((r) => (r[3] && seen.get(base(r)) === 1
    ? base(r)
    : [slug(r[0]), slug(r[3]), slug(r[2])].filter(Boolean).join('-')));
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new Error(`Two machines produce the same id: ${dup}`);
  return ids;
}
