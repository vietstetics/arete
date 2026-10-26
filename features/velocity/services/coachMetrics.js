// Pure presentation over durable records: one convention, one eligibility rule, honest unavailable states.
// No prediction is inferred here; reported effort and supplied model output have separate displays.
export const COACH_METRICS_VERSION = 'coach-metrics-v1';
const finite = (v) => Number.isFinite(v);
const positive = (v) => finite(v) && v > 0;
const number = (v) => finite(v) ? v : null;
const average = (values) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const maximum = (values) => values.length ? Math.max(...values) : null;
const values = (rows, key) => rows.map((r) => r[key]).filter(finite);
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (value, digits = 2) => finite(value) ? value.toFixed(digits) : 'Unavailable';
const unavailable = (reason) => ({ status: 'unavailable', estimate: null, range: null, reason });

function normalizePrediction(prediction, fallback) {
  if (!prediction || prediction.status !== 'available' || !finite(prediction.estimate)) {
    return { ...unavailable(prediction?.reason || fallback), ...(prediction?.method ? { method: prediction.method } : {}) };
  }
  const range = Array.isArray(prediction.range) && prediction.range.length === 2 && prediction.range.every(finite)
    && prediction.range[0] <= prediction.range[1] ? prediction.range.slice() : null;
  return { ...prediction, range };
}

/** The numbers in summary.mean/fastest/last are m/s when scaled, otherwise % of the original valid rep. */
export function coachMetrics(record = {}, { predictions = record.predictions } = {}) {
  const scaled = record.units === 'm/s';
  const input = Array.isArray(record.reps) ? record.reps : [];
  const physicalOwn = (r) => positive(r.mcvOwn) ? r.mcvOwn : positive(r.distance) && positive(r.T) ? r.distance / r.T : r.mcv;
  const nativeOwn = (r) => positive(r.nativeMcv) ? r.nativeMcv : record.v < 2 && !scaled && positive(r.mcv) ? r.mcv : null;
  const original = input.find((r) => r.isStandard && r.result === 'counted' && r.velocity === 'ok');
  const first = original ? (scaled ? physicalOwn(original) : nativeOwn(original)) : null;
  const standardSpan = finite(record.standard?.start) && finite(record.standard?.finish) ? Math.abs(record.standard.start - record.standard.finish) : null;
  const rows = input.map((r, i) => {
    const own = scaled ? physicalOwn(r) : nativeOwn(r);
    const eligible = r.result === 'counted' && r.velocity === 'ok' && (positive(own) || positive(r.rel));
    const rel = eligible && positive(first) && positive(own) ? own / first : eligible && positive(r.rel) ? r.rel : null;
    const start = number(r.rom?.start), finish = number(r.rom?.finish);
    const span = finite(start) && finite(finish) ? Math.abs(start - finish) : null;
    return {
      n: r.n ?? i + 1, result: r.result || 'unclear', isStandard: !!r.isStandard, available: eligible,
      mcv: eligible && scaled && positive(own) ? own : null, mcvOwn: eligible && scaled && positive(own) ? own : null,
      standardizedMcv: eligible && scaled ? number(r.standardizedMcv ?? (record.v < 2 ? r.mcv : null)) : null,
      mpv: eligible && scaled ? number(r.mpv) : null, peak: eligible && scaled ? number(r.peak ?? r.pv) : null,
      nativeMcv: eligible && !scaled ? number(own) : null,
      nativePeak: eligible && !scaled ? number(r.nativePeak ?? (record.v < 2 ? r.peak : null)) : null,
      nativeDistance: eligible && !scaled ? number(r.nativeDistance) : null,
      duration: eligible && positive(r.T) ? r.T : null, distance: eligible && scaled ? number(r.distance) : null,
      rel, relativePct: finite(rel) ? rel * 100 : null,
      originalLossPct: finite(rel) ? (1 - rel) * 100 : null,
      standardLossPct: eligible && finite(r.standardRel) ? (1 - r.standardRel) * 100 : null,
      standardizedLossPct: eligible && finite(r.standardRel) ? (1 - r.standardRel) * 100 : null,
      romStart: start, romFinish: finish, romPct: positive(standardSpan) && finite(span) ? 100 * span / standardSpan : null,
      avgPower: eligible && scaled ? number(r.avgPower) : null, peakPower: eligible && scaled ? number(r.peakPower) : null,
      peakForce: eligible && scaled ? number(r.peakForce) : null,
      estimate: r.estimate || null, why: r.why || r.velocityWhy || (!eligible ? 'No accepted concentric measurement' : ''),
      badges: r.badges || {},
    };
  });
  const validRows = rows.filter((r) => r.available);
  const metric = (r) => scaled ? r.mcv : r.relativePct;
  const measured = validRows.filter((r) => positive(metric(r)));
  const speeds = measured.map(metric), fastest = maximum(speeds), latest = measured.at(-1);
  for (const row of rows) row.lossPct = row.available && positive(fastest) && positive(metric(row)) ? 100 * (1 - metric(row) / fastest) : null;
  const summary = {
    mean: average(speeds), fastest, last: latest ? metric(latest) : null,
    peak: scaled ? maximum(values(validRows, 'peak')) : null,
    mpv: scaled ? average(values(validRows, 'mpv')) : null,
    duration: average(values(validRows, 'duration')), totalConcentricTime: values(validRows, 'duration').reduce((a, b) => a + b, 0) || null,
    distance: scaled ? average(values(validRows, 'distance')) : null,
    standardDistance: scaled ? number(record.D) : null,
    romConsistencyPct: validRows.at(-1)?.romPct ?? null,
    lossPct: measured.length >= 2 ? latest.lossPct : null,
    standardLossPct: measured.length >= 2 ? latest.standardLossPct : null,
    originalLossPct: measured.length >= 2 ? latest.originalLossPct : null,
    standardizedLossPct: measured.length >= 2 ? latest.standardizedLossPct : null,
    intraSetFatiguePct: measured.length >= 2 ? 100 * (fastest - Math.min(...speeds)) / fastest : null,
    avgPower: scaled ? average(values(validRows, 'avgPower')) : null,
    peakPower: scaled ? maximum(values(validRows, 'peakPower')) : null,
    peakForce: scaled ? maximum(values(validRows, 'peakForce')) : null,
    comparisonRep: latest?.n ?? null, fastestRep: measured.find((r) => metric(r) === fastest)?.n ?? null,
    nativeMean: !scaled ? average(values(validRows, 'nativeMcv')) : null,
    nativePeak: !scaled ? maximum(values(validRows, 'nativePeak')) : null,
    nativeDistance: !scaled ? average(values(validRows, 'nativeDistance')) : null,
  };
  const manualCount = rows.length === 0 && Number.isInteger(record.completedReps) && record.completedReps >= 0 ? record.completedReps : null;
  const singleVerified = record.tested1RM?.verified === true && positive(record.tested1RM.loadKg)
    && (!positive(record.loadKg) || record.tested1RM.loadKg === record.loadKg)
    && (rows.length === 1 && rows[0].result === 'counted' || manualCount === 1);
  return {
    version: COACH_METRICS_VERSION, scaled, units: scaled ? 'm/s' : '% of standard', nativeUnits: record.nativeUnits || 'native-units',
    loadKg: number(record.loadKg), fps: number(record.fps), summary, rows, validRows, manualCount,
    restSeconds: number(record.restSeconds ?? record.restSec), restMethod: record.restMethod || null,
    counts: { attempted: rows.length, counted: manualCount ?? rows.filter((r) => r.result === 'counted').length,
      short: rows.filter((r) => r.result === 'short').length, unclear: rows.filter((r) => r.result === 'unclear').length, measured: measured.length },
    reportedEffort: record.reportedEffort || { rir: number(record.typedRir), rpe: null, enteredAs: 'rir' },
    failureEndpoint: record.failureEndpoint || null,
    tested1RM: singleVerified ? record.tested1RM : null,
    massContext: record.massContext || null,
    quality: record.quality || null, calibration: record.calibration || null,
    measurementVersion: record.measurementVersion || 'legacy/unspecified', calibrationVersion: record.calibrationVersion || record.calibration?.version || 'unverified',
    predictions: {
      version: predictions?.version || null,
      rir: normalizePrediction(predictions?.rir, 'Insufficient individual RIR calibration'),
      rpe: normalizePrediction(predictions?.rpe, 'A supported RIR prediction is required'),
      oneRm: normalizePrediction(predictions?.oneRm, 'Validated physical velocities and an individual load–velocity profile are required'),
      repetitionOneRm: normalizePrediction(predictions?.repetitionOneRm, 'Load, valid repetitions and suitable reported effort are required'),
    },
  };
}

/** Shared HTML for the live summary and workout history; every external string is escaped. */
export function renderCoachMetrics(record = {}, options = {}) {
  const m = coachMetrics(record, options), s = m.summary;
  const metric = (label, value, unit = '', digits = 2, detail = '') => `<div class="coach-metric"><span class="coach-metric-label">${escape(label)}</span><strong class="coach-metric-value">${finite(value) ? `${fmt(value, digits)}${unit ? ` <small>${escape(unit)}</small>` : ''}` : 'Unavailable'}</strong>${detail ? `<span class="coach-metrics-note">${escape(detail)}</span>` : ''}</div>`;
  const physicalReason = m.scaled ? 'Camera estimate; review calibration and tracking quality' : 'Physical scale unavailable';
  const calibration = m.calibration?.validated === true ? 'Physical calibration validated' : m.scaled ? 'Physical scale supplied; camera accuracy remains unvalidated' : 'Relative measurements only; no physical calibration';
  const quality = m.quality?.accepted === true ? 'Tracking accepted for individual modelling' : 'Tracking not accepted for individual modelling';
  const prediction = (label, p, unit) => {
    const estimate = p.status === 'available' ? `${fmt(p.estimate, unit === 'kg' ? 1 : 1)} ${escape(unit)}` : 'Unavailable';
    const interval = p.range ? `Range ${fmt(p.range[0], 1)}–${fmt(p.range[1], 1)} ${unit}` : p.status === 'available' ? 'No calibrated uncertainty range supplied' : '';
    return `<div class="coach-prediction"><span class="coach-metric-label">${escape(label)}</span><strong class="coach-metric-value">${estimate}</strong><span class="coach-status">${escape(p.status)}</span><p class="coach-metrics-note">${escape([interval, p.reason, p.method].filter(Boolean).join(' · '))}</p></div>`;
  };
  const cell = (value, digits = 2) => finite(value) ? fmt(value, digits) : '—';
  const rows = m.rows.map((r) => `<tr><td>${escape(r.n)}${r.isStandard ? ' (standard)' : ''}</td><td>${escape(r.result)}</td><td>${cell(m.scaled ? r.mcv : r.relativePct)}</td><td>${cell(r.standardizedMcv)}</td><td>${cell(r.mpv)}</td><td>${cell(r.peak)}</td><td>${cell(r.duration, 3)}</td><td>${cell(r.distance, 3)}</td><td>${cell(r.romStart, 1)} → ${cell(r.romFinish, 1)}</td><td>${cell(r.romPct, 0)}</td><td>${cell(r.lossPct, 1)}</td><td>${cell(r.originalLossPct, 1)}</td><td>${cell(r.avgPower, 0)}</td><td>${cell(r.peakPower, 0)}</td><td>${cell(r.peakForce, 0)}</td><td>${cell(r.nativeMcv)}</td><td>${cell(r.nativePeak)}</td><td>${cell(r.nativeDistance, 3)}</td><td>${escape([r.why, typeof r.estimate === 'string' ? r.estimate : r.estimate ? 'Estimate' : '', r.badges.pv && r.badges.pv !== 'reliable' ? 'Peak velocity estimate' : ''].filter(Boolean).join(' · ')) || '—'}</td></tr>`).join('');
  const reported = m.reportedEffort;
  return `<section class="coach-metrics" aria-label="Set measurements and predictions"><p class="coach-metrics-note">${escape(calibration)}. ${escape(quality)}. MCV uses each rep’s own displacement / concentric time; MPV is a different metric.</p><div class="coach-metrics-grid">` +
    metric('Load', m.loadKg, 'kg', 1) + metric(m.manualCount === null ? 'Counted reps' : 'Manually logged reps', m.counts.counted, '', 0, m.manualCount === null ? `${m.counts.attempted} attempted · ${m.counts.short} short · ${m.counts.unclear} unclear` : 'No camera repetitions were observed') +
    metric('Reps with velocity', m.counts.measured, '', 0) + metric('Mean concentric velocity', s.mean, m.units) +
    metric('Fastest valid rep', s.fastest, m.units) + metric('Latest valid rep', s.last, m.units) +
    metric('Velocity loss', s.lossPct, '%', 1, s.comparisonRep == null ? 'Needs two valid measured reps' : `Rep ${s.comparisonRep} vs fastest valid rep ${s.fastestRep}`) +
    metric('Loss vs original rep (own MCV)', s.originalLossPct, '%', 1) + metric('Standard D/T loss', s.standardLossPct, '%', 1) + metric('Intra-set range', s.intraSetFatiguePct, '%', 1, 'Fastest vs slowest valid rep') +
    metric('Peak concentric velocity', s.peak, 'm/s', 2, physicalReason) + metric('Mean propulsive velocity', s.mpv, 'm/s', 2, physicalReason) +
    metric('Mean concentric duration', s.duration, 's', 3) + metric('Total concentric time', s.totalConcentricTime, 's', 2) +
    metric('Mean displacement', s.distance, 'm', 3, physicalReason) + metric('Locked standard distance', s.standardDistance, 'm', 3) +
    metric('Latest ROM vs standard', s.romConsistencyPct, '%', 0, 'Tracked movement span; not a claim of full anatomical ROM') +
    metric('Average power', s.avgPower, 'W', 0, typeof m.massContext === 'string' ? m.massContext : m.massContext ? `System mass: ${m.massContext.systemMassKg ?? 'unspecified'} kg; ${m.massContext.type || 'specified model'}` : 'Requires physical displacement and an explicit system-mass model') +
    metric('Peak power', s.peakPower, 'W', 0, 'Estimate when available') + metric('Peak force', s.peakForce, 'N', 0, 'Estimate when available') +
    metric('Processing frame rate', m.fps, 'fps', 1) + metric('User-reported RIR', number(reported.rir), '', 1) + metric('User-reported RPE', number(reported.rpe), '', 1) +
    metric('Rest before set', m.restSeconds, 's', 0, m.restMethod || 'Unavailable unless recorded') +
    metric('Actual tested 1RM', number(m.tested1RM?.loadKg), 'kg', 1, m.tested1RM?.verified ? 'User-verified maximal attempt' : 'No verified maximal attempt') +
    `</div><div class="coach-predictions">${prediction('Estimated RIR', m.predictions.rir, 'RIR')}${prediction('Estimated RPE', m.predictions.rpe, 'RPE')}${prediction('Velocity-based estimated 1RM', m.predictions.oneRm, 'kg')}${prediction('Repetition-based estimated 1RM', m.predictions.repetitionOneRm, 'kg')}</div>` +
    `<p class="coach-metrics-note">${escape(m.quality?.note || '')} ${escape(m.calibration?.kind || m.calibration?.method || '')} ${escape(m.failureEndpoint?.verified ? `Verified failure endpoint: ${m.failureEndpoint.type || 'unspecified'}` : 'No verified failure endpoint recorded')}. Measurement ${escape(m.measurementVersion)} · calibration ${escape(m.calibrationVersion)} · prediction ${escape(m.predictions.version || 'unavailable')}.</p>` +
    `<details><summary>Every rep: measurements, ROM and quality</summary><div class="coach-reps-wrap"><table class="coach-reps-table"><thead><tr><th>Rep</th><th>ROM verdict</th><th>MCV (${escape(m.units)})</th><th>Standard D/T (m/s)</th><th>MPV (m/s)</th><th>Peak (m/s)</th><th>Time (s)</th><th>Distance (m)</th><th>Tracked ROM</th><th>ROM (%)</th><th>Loss vs fastest (%)</th><th>Loss vs original (%)</th><th>Avg power (W)</th><th>Peak power (W)</th><th>Peak force (N)</th><th>Native mean (${escape(m.nativeUnits)}/s)</th><th>Native peak (${escape(m.nativeUnits)}/s)</th><th>Native distance (${escape(m.nativeUnits)})</th><th>Quality / unavailable reason</th></tr></thead><tbody>${rows || '<tr><td colspan="19">No repetitions recorded</td></tr>'}</tbody></table></div></details></section>`;
}
