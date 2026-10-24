// Validation and presentation of an external, locally run BarbellCV result. No upstream GPL code is
// embedded here. Imported 2D path-speed measurements stay separate from Arete's vertical/ROM counts,
// workout metrics and personal models. A file cannot certify its own measurement accuracy.
export const BARBELLCV_FORMAT = 'arete-barbellcv-analysis-v1';
export const BARBELLCV_REVISION = '7ffcd8853a3dbfb8da2b1993f63d844d3279cd2a';
export const BARBELLCV_CONVENTION = 'barbellcv-2d-path-speed-v1';
export const MAX_EXTERNAL_ANALYSIS_BYTES = 1024 * 1024;
const MAX_ROWS = 2000;
const finite = (n) => Number.isFinite(n);
const nonnegative = (n) => finite(n) && n >= 0;
const positive = (n) => finite(n) && n > 0;
const text = (value, limit) => typeof value === 'string' && value.length <= limit ? value : null;
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const failure = (message) => { throw new Error(`BarbellCV analysis: ${message}`); };

/** Parse an untrusted file against the exact destination set; unknown keys never enter the workout. */
export function parseBarbellCvAnalysis(json, { recordId } = {}) {
  if (typeof recordId !== 'string' || !recordId.trim() || recordId.length > 256) failure('a destination record ID is required');
  let input, encoded;
  if (typeof json === 'string') {
    encoded = json;
    if (new TextEncoder().encode(encoded).length > MAX_EXTERNAL_ANALYSIS_BYTES) failure('file exceeds the 1 MB limit');
    try { input = JSON.parse(json); } catch { failure('file is not valid JSON'); }
  } else {
    input = json;
    try { encoded = JSON.stringify(json); } catch { failure('result is not serializable JSON'); }
    if (typeof encoded !== 'string' || new TextEncoder().encode(encoded).length > MAX_EXTERNAL_ANALYSIS_BYTES) failure('result exceeds the 1 MB limit');
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) failure('expected an analysis object');
  if (input.format !== BARBELLCV_FORMAT) failure('unsupported result format');
  if (input.recordId !== recordId) failure('result belongs to a different set');
  if (input.upstreamRevision !== BARBELLCV_REVISION) failure('upstream revision does not match the supported local helper');
  if (!['relative', 'm/s'].includes(input.units)) failure('units must be relative or m/s');
  if (input.convention != null && input.convention !== BARBELLCV_CONVENTION) failure('unsupported velocity convention');
  const physical = input.units === 'm/s';
  const c = input.calibration;
  if (physical && (!c || !positive(c.diameterM) || !positive(c.markerRadiusPx))) failure('m/s requires the measured marker diameter and its image radius');
  if (c && (typeof c !== 'object' || Array.isArray(c))) failure('invalid calibration object');
  for (const key of ['diameterM', 'markerRadiusPx']) if (c?.[key] != null && !positive(c[key])) failure(`calibration ${key} must be finite and positive`);
  const measurements = input.measurements;
  if (!Array.isArray(measurements) || measurements.length > MAX_ROWS) failure('invalid or excessive measurement rows');
  let previousEnd = -Infinity;
  const rows = measurements.map((r, i) => {
    if (!r || typeof r !== 'object' || Array.isArray(r) || r.n !== i + 1) failure('measurement numbers must be unique and sequential');
    for (const key of ['tStart', 'tEnd', 'mcv', 'pv', 'T', 'distance', 'pathDistance', 'xRom', 'yRom']) {
      if (!nonnegative(r[key])) failure(`row ${r.n}: ${key} must be finite and nonnegative`);
    }
    if (!(r.tEnd > r.tStart) || !positive(r.T)) failure(`row ${r.n}: duration must be positive`);
    const tolerance = Math.max(1e-6, r.T * 1e-5);
    if (Math.abs(r.T - (r.tEnd - r.tStart)) > tolerance) failure(`row ${r.n}: duration differs from its timestamps`);
    if (r.tStart < previousEnd - 1e-8) failure(`row ${r.n}: movement intervals overlap or are out of order`);
    if (r.pv + 1e-6 < r.mcv) failure(`row ${r.n}: peak speed is below mean speed`);
    // A traversed 2D path cannot be shorter than either of its coordinate ranges. Mean speed is an
    // upstream sample average, so mcv*T need not equal pathDistance on irregularly sampled frames.
    if (r.pathDistance + Math.max(1e-6, r.pathDistance * 1e-5) < Math.max(r.xRom, r.yRom)) failure(`row ${r.n}: path is shorter than its coordinate range`);
    previousEnd = r.tEnd;
    return Object.fromEntries(['n', 'tStart', 'tEnd', 'mcv', 'pv', 'T', 'distance', 'pathDistance', 'xRom', 'yRom'].map((k) => [k, r[k]]));
  });
  return {
    format: BARBELLCV_FORMAT, engine: 'BarbellCV', recordId, upstreamRevision: BARBELLCV_REVISION,
    convention: BARBELLCV_CONVENTION, units: input.units,
    // Importing a declared diameter is evidence of an assumed scale, not reference-device validation.
    calibration: { diameterM: c?.diameterM ?? null, markerRadiusPx: c?.markerRadiusPx ?? null,
      method: physical ? 'marker diameter / image radius; 2D perspective assumptions' : 'relative path coordinates',
      validated: false, estimate: true },
    estimate: true, validated: false,
    generatedAt: text(input.generatedAt, 128), nativeUnits: text(input.nativeUnits, 64),
    measurements: rows,
    limitations: [
      'BarbellCV reports the sample mean and peak of 2D path speed, including horizontal movement; this differs from Arete’s vertical mean concentric velocity.',
      'Segmentation, smoothing and endpoint rules differ. Movement segments are not Arete counted or ROM-approved reps.',
      'Camera motion, perspective, marker-size assumptions and measurement accuracy remain unvalidated.',
      'Imported results do not replace Arete repetitions, workout velocities, effort predictions or load–velocity profiles.',
    ],
  };
}

/** Escaped shared coach-card markup; render only a normalized result from parseBarbellCvAnalysis. */
export function renderBarbellCvAnalysis(result) {
  if (!result || result.format !== BARBELLCV_FORMAT || result.convention !== BARBELLCV_CONVENTION || !Array.isArray(result.measurements)) return '';
  const physical = result.units === 'm/s', speedUnit = physical ? 'm/s (estimate)' : 'native path units/s';
  const lengthUnit = physical ? 'm (estimate)' : 'native path units';
  const f = (value, places = 3) => finite(value) ? value.toFixed(places) : 'Unavailable';
  const rows = result.measurements.map((r) => `<tr><td>${escape(r.n)}</td><td>${f(r.tStart)}</td><td>${f(r.tEnd)}</td><td>${f(r.T)}</td><td>${f(r.mcv)}</td><td>${f(r.pv)}</td><td>${f(r.distance)}</td><td>${f(r.pathDistance)}</td><td>${f(r.xRom)}</td><td>${f(r.yRom)}</td></tr>`).join('');
  return `<section class="coach-metrics" aria-label="BarbellCV local analysis"><h3>BarbellCV local analysis</h3><p class="coach-metrics-note">External 2D path-speed estimates. These use a different measurement convention from Arete’s own vertical mean concentric velocity.</p>` +
    `<div class="coach-metrics-grid"><div class="coach-metric"><span class="coach-metric-label">External motion segments</span><strong class="coach-metric-value">${result.measurements.length}</strong></div><div class="coach-metric"><span class="coach-metric-label">Speed convention</span><strong class="coach-metric-value">2D path speed</strong></div><div class="coach-metric"><span class="coach-metric-label">Physical validation</span><strong class="coach-metric-value">Unvalidated estimate</strong></div></div>` +
    `<p class="coach-metrics-note">${physical ? `Marker diameter ${f(result.calibration?.diameterM)} m; image radius ${f(result.calibration?.markerRadiusPx, 1)} px. Physical scale depends on the marker and viewing geometry.` : 'No physical calibration: native path units remain relative and are never metres or m/s.'} Upstream ${escape(result.upstreamRevision)}.</p>` +
    `<div class="coach-reps-wrap"><table class="coach-reps-table"><thead><tr><th>Segment</th><th>Start (s)</th><th>End (s)</th><th>Duration (s)</th><th>Mean path speed (${escape(speedUnit)})</th><th>Peak path speed (${escape(speedUnit)})</th><th>Displacement (${escape(lengthUnit)})</th><th>Path distance (${escape(lengthUnit)})</th><th>X range (${escape(lengthUnit)})</th><th>Y range (${escape(lengthUnit)})</th></tr></thead><tbody>${rows || '<tr><td colspan="10">No motion segments were detected</td></tr>'}</tbody></table></div>` +
    `<ul class="coach-metrics-note">${(Array.isArray(result.limitations) ? result.limitations : []).map((note) => `<li>${escape(note)}</li>`).join('')}</ul>` +
    `<p class="coach-metrics-note"><a href="docs/barbellcv-integration.md">Local analysis instructions and limitations</a> · <a href="https://github.com/tlancon/barbellcv/tree/${BARBELLCV_REVISION}" target="_blank" rel="noopener noreferrer">Pinned BarbellCV source</a>. Arete’s counts, measurements and personal models stay separate.</p></section>`;
}
