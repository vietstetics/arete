// The "Resistance profile" column → a category for display and comparison.
// Pure. The text is always kept verbatim; the category only groups it.
//
// Comparable categories describe one curve: ASCENDING, DESCENDING,
// BELL-SHAPED, CONSTANT. The rest say the curve depends on the exercise,
// a setting or an unpublished cam, so two machines can't be compared on
// profile — the overlap check treats them as "not specified".
//
// BELL-SHAPED is kept as its own category. It is not converted to the
// specification's MID-RANGE: the two sources use different wording and the
// equivalence hasn't been reviewed.

const RULES = [
  [/^Bell-shaped$/, 'BELL-SHAPED', true],
  [/^Ascending$/, 'ASCENDING', true],
  [/^Descending$/, 'DESCENDING', true],
  [/^Constant$/, 'CONSTANT', true],
  [/^Exercise-dependent(?:: .+)?$/, 'EXERCISE-DEPENDENT', false],
  [/^Adjustable: .+$/, 'ADJUSTABLE', false],
  [/^Mode-dependent: .+$/, 'MODE-DEPENDENT', false],
  [/^Configuration-dependent: .+$/, 'CONFIGURATION-DEPENDENT', false],
  [/^Selectable: .+$/, 'SELECTABLE', false],
  [/^Variable: .+$/, 'VARIABLE', false],
];

export const PROFILE_LABELS = {
  'BELL-SHAPED': 'Bell-shaped', ASCENDING: 'Ascending', DESCENDING: 'Descending', CONSTANT: 'Constant',
  'EXERCISE-DEPENDENT': 'Exercise-dependent', ADJUSTABLE: 'Adjustable', 'MODE-DEPENDENT': 'Mode-dependent',
  'CONFIGURATION-DEPENDENT': 'Configuration-dependent', SELECTABLE: 'Selectable', VARIABLE: 'Variable',
};

/** "Exercise-dependent: near-constant cable tension" → category + detail. */
export function parseProfile(text) {
  const raw = String(text ?? '');
  for (const [re, category, comparable] of RULES) {
    if (re.test(raw)) {
      const i = raw.indexOf(': ');
      return { raw, category, comparable, detail: i >= 0 ? raw.slice(i + 2) : null };
    }
  }
  throw new Error(`Unrecognised resistance profile: "${raw}"`);
}

/** Profile value the overlap catalogue compares ('Not specified' = unknown). */
export const overlapProfile = (p) => (p.comparable ? p.category : 'Not specified');

// Source type → a short trust label. The full text is always shown too.
export function sourceKind(sourceType) {
  const s = String(sourceType || '');
  if (!s) return { key: 'none', label: 'No source recorded' };
  if (/^Manufacturer/.test(s)) return { key: 'manufacturer', label: 'Manufacturer' };
  if (/^(Retailer claim|Supplier article|Product catalogue)$/.test(s)) return { key: 'third-party', label: 'Retailer / supplier' };
  if (/^(Estimated mechanics|Mechanical inference)/.test(s)) return { key: 'estimated', label: 'Estimated' };
  throw new Error(`Unrecognised source type: "${s}"`);
}
