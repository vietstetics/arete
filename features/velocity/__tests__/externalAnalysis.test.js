import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBarbellCvAnalysis, renderBarbellCvAnalysis, BARBELLCV_FORMAT, BARBELLCV_REVISION,
  BARBELLCV_CONVENTION, MAX_EXTERNAL_ANALYSIS_BYTES } from '../services/externalAnalysis.js';

function fixture(extra = {}) {
  return {
    format: BARBELLCV_FORMAT, recordId: 'set-123', upstreamRevision: BARBELLCV_REVISION,
    units: 'relative', convention: BARBELLCV_CONVENTION,
    measurements: [
      { n: 1, tStart: 1, tEnd: 2, T: 1, mcv: 0.6, pv: 0.9, distance: 0.5, pathDistance: 0.6, xRom: 0.2, yRom: 0.5 },
      { n: 2, tStart: 3, tEnd: 4.2, T: 1.2, mcv: 0.5, pv: 0.8, distance: 0.48, pathDistance: 0.55, xRom: 0.15, yRom: 0.48 },
    ], ...extra,
  };
}
const parse = (value, options = { recordId: 'set-123' }) => parseBarbellCvAnalysis(value, options);

test('imports a pinned, set-bound BarbellCV result without changing Arete metrics or prediction fields', () => {
  const input = fixture({ counted: 500, reps: [{ result: 'counted', mcv: 99 }], predictions: { rir: 0 }, calibration: { validated: true } });
  const copy = structuredClone(input);
  const r = parse(JSON.stringify(input));
  assert.equal(r.recordId, 'set-123');
  assert.equal(r.convention, BARBELLCV_CONVENTION);
  assert.equal(r.measurements.length, 2);
  assert.equal(r.estimate, true);
  assert.equal(r.validated, false);
  assert.equal(r.calibration.validated, false);
  assert.equal(r.counted, undefined);
  assert.equal(r.reps, undefined);
  assert.equal(r.predictions, undefined);
  assert.deepEqual(input, copy, 'source object stays unchanged');
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
});

test('result IDs, format and exact source revisions cannot silently migrate to another set or implementation', () => {
  for (const bad of [fixture({ recordId: 'another-set' }), fixture({ format: 'other-v1' }), fixture({ upstreamRevision: '0'.repeat(40) }), fixture({ convention: 'vertical-mcv' })]) assert.throws(() => parse(bad));
  assert.throws(() => parse(fixture(), {}), /destination record ID/);
  assert.throws(() => parse(fixture(), { recordId: '' }), /destination record ID/);
  assert.throws(() => parse('{invalid'), /valid JSON/);
  assert.throws(() => parse('[]'), /analysis object/);
});

test('physical output requires explicit finite marker scale and remains an unvalidated estimate', () => {
  const physical = fixture({ units: 'm/s' });
  assert.throws(() => parse(physical), /diameter/);
  physical.calibration = { diameterM: 0.05, markerRadiusPx: 12, validated: true, estimate: false };
  const r = parse(physical), html = renderBarbellCvAnalysis(r);
  assert.equal(r.units, 'm/s');
  assert.equal(r.calibration.diameterM, 0.05);
  assert.equal(r.calibration.markerRadiusPx, 12);
  assert.equal(r.calibration.validated, false);
  assert.equal(r.calibration.estimate, true);
  assert.match(html, /m\/s \(estimate\)/);
  assert.match(html, /Unvalidated estimate/);
  for (const bad of [0, -1, NaN, Infinity, '0.05']) {
    assert.throws(() => parse(fixture({ units: 'm/s', calibration: { diameterM: bad, markerRadiusPx: 12 } })));
    assert.throws(() => parse(fixture({ units: 'm/s', calibration: { diameterM: 0.05, markerRadiusPx: bad } })));
  }
  assert.throws(() => parse(fixture({ units: 'pixels/s' })), /units/);
});

test('nonfinite, negative or string metrics fail closed instead of becoming nulls or zeros', () => {
  for (const field of ['tStart', 'tEnd', 'T', 'mcv', 'pv', 'distance', 'pathDistance', 'xRom', 'yRom']) {
    for (const value of [NaN, Infinity, -1, '1', null, undefined]) {
      const r = fixture(); r.measurements[0][field] = value;
      assert.throws(() => parse(r), Error, `${field}: ${value}`);
    }
  }
});

test('movement windows require positive consistent durations, chronological nonoverlap and sequential labels', () => {
  for (const change of [
    (r) => { r.measurements[0].T = 0; },
    (r) => { r.measurements[0].T = 2; },
    (r) => { r.measurements[0].tEnd = 1; },
    (r) => { r.measurements[1].tStart = 1.9; r.measurements[1].T = 2.3; },
    (r) => { r.measurements[1].n = 1; },
    (r) => { r.measurements.reverse(); },
  ]) { const r = fixture(); change(r); assert.throws(() => parse(r)); }
  const touching = fixture(); touching.measurements[1].tStart = 2; touching.measurements[1].T = 2.2;
  assert.equal(parse(touching).measurements.length, 2, 'adjacent nonoverlapping windows are allowed');
});

test('path quantities stay internally possible without assuming sample-mean speed equals path/time', () => {
  const r = fixture();
  r.measurements[0].mcv = 0.8; // irregular timestamps can separate sample mean from time-weighted path/T
  assert.equal(parse(r).measurements[0].mcv, 0.8);
  r.measurements[0].pv = 0.7;
  assert.throws(() => parse(r), /peak speed/);
  const impossible = fixture(); impossible.measurements[0].pathDistance = 0.3;
  assert.throws(() => parse(impossible), /coordinate range/);
});

test('parser caps file size and excessive rows, clones fields and drops unexpected nested payloads', () => {
  assert.throws(() => parse(JSON.stringify(fixture({ padding: 'x'.repeat(MAX_EXTERNAL_ANALYSIS_BYTES) }))), /1 MB/);
  const many = fixture({ measurements: Array.from({ length: 2001 }, () => ({})) });
  assert.throws(() => parse(many), /excessive/);
  const input = fixture(); input.measurements[0].injected = { predictions: 'bad' };
  const output = parse(input);
  output.measurements[0].mcv = 123;
  assert.equal(input.measurements[0].mcv, 0.6);
  assert.equal(output.measurements[0].injected, undefined);
});

test('renderer labels native 2D path speed and each distance/ROM component without implying counted reps', () => {
  const html = renderBarbellCvAnalysis(parse(fixture()));
  for (const label of ['BarbellCV local analysis', 'Mean path speed', 'Peak path speed', 'Duration', 'Displacement', 'Path distance', 'X range', 'Y range']) assert.match(html, new RegExp(label));
  assert.match(html, /native path units\/s/);
  assert.match(html, /different measurement convention/);
  assert.match(html, /docs\/barbellcv-integration\.md/);
  assert.match(html, /do not replace Arete/);
  assert.match(html, /External motion segments/);
});

test('rendering escapes external text and handles an empty analysis without inventing a measurement', () => {
  const r = parse(fixture({ measurements: [] }));
  r.limitations.push('<img src=x onerror=alert(1)>');
  r.upstreamRevision = '<script>bad</script>';
  const html = renderBarbellCvAnalysis(r);
  assert.match(html, /No motion segments were detected/);
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;img/);
  assert.equal(renderBarbellCvAnalysis({}), '');
});
