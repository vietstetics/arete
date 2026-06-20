/* ============================================================================
 *  ENERGY INTELLIGENCE ENGINE
 *  Pure, deterministic functions (no AI model) that predict three 0–100
 *  scores every 30 minutes: Focus potential, Physical performance, Overall
 *  energy. Implements the two-process model of alertness (homeostatic sleep
 *  pressure + circadian rhythm) plus sleep inertia, an afternoon dip, the
 *  user's reported morning state, and gradual personalisation from logged
 *  observations.
 *
 *  The spec was written in TypeScript; this app ships vanilla JS with no build
 *  step, so the same formulas are implemented here as plain ES functions and
 *  exposed on `window.Energy`. Every formula is annotated with the check-in
 *  question(s) that feed it.
 * ==========================================================================*/
(function (global) {
  'use strict';

  // ── Helper: clamp a value (spec §Helper) ─────────────────────────────────
  function clamp(value, min, max) {
    if (min === undefined) min = 0;
    if (max === undefined) max = 1;
    return Math.min(max, Math.max(min, value));
  }

  // ── Time helpers ─────────────────────────────────────────────────────────
  // "HH:MM" -> decimal hours (e.g. "23:30" -> 23.5). Returns null if blank.
  function toHour(hhmm) {
    if (hhmm == null || hhmm === '') return null;
    if (typeof hhmm === 'number') return hhmm;
    const m = String(hhmm).match(/^(\d{1,2}):(\d{2})/);
    if (!m) return null;
    const h = parseInt(m[1], 10), min = parseInt(m[2], 10);
    if (isNaN(h) || isNaN(min)) return null;
    return h + min / 60;
  }

  // Sleep duration in hours from onset->wake, wrapping past midnight.
  function sleepDuration(onsetHour, wakeHour) {
    if (onsetHour == null || wakeHour == null) return null;
    let d = wakeHour - onsetHour;
    if (d <= 0) d += 24;            // onset in the evening, wake next morning
    return d;
  }

  function fmtHour(h) {
    if (h == null || isNaN(h)) return '—';
    h = ((h % 24) + 24) % 24;
    let hr = Math.floor(h + 1e-9);
    let min = Math.round((h - hr) * 60);
    if (min === 60) { min = 0; hr = (hr + 1) % 24; }
    const sfx = hr < 12 ? 'AM' : 'PM';
    const disp = hr === 0 ? 12 : hr > 12 ? hr - 12 : hr;
    return disp + ':' + String(min).padStart(2, '0') + ' ' + sfx;
  }

  function fmtRange(a, b) {
    if (a == null || b == null) return '—';
    return fmtHour(a) + ' – ' + fmtHour(b);
  }

  /* ==========================================================================
   *  1. SLEEP PRESSURE  (homeostatic process S, 0..1)   — spec §1
   *     Questions: "What time did you fall asleep?", "What time did you wake
   *     up?" (today + the previous nights in the sleep log).
   *     While awake S rises toward 1 (τ = 18.2h); while asleep S falls
   *     (τ = 4.2h). alertness = 1 − S.
   * ========================================================================*/
  function awakeStep(prevS, hoursPassed) {
    return 1 - (1 - prevS) * Math.exp(-hoursPassed / 18.2);
  }
  function sleepStep(prevS, hoursSlept) {
    return prevS * Math.exp(-hoursSlept / 4.2);
  }

  // Turn a sleep log into absolute onset/wake timestamps and simulate S across
  // (up to) the last `days` nights, returning S at the most recent wake-up.
  // Each record: { date:"YYYY-MM-DD" (wake date), onset:"HH:MM", wake:"HH:MM" }.
  function sleepPressureAtWake(sleepLog, days) {
    if (days === undefined) days = 7;
    const recs = (sleepLog || [])
      .map(function (r) {
        const wakeH = toHour(r.wake), onsetH = toHour(r.onset);
        if (wakeH == null || onsetH == null || !r.date) return null;
        const dur = sleepDuration(onsetH, wakeH);
        const wakeTs = new Date(r.date + 'T00:00:00').getTime() + wakeH * 3600e3;
        const onsetTs = wakeTs - dur * 3600e3;
        return { onsetTs: onsetTs, wakeTs: wakeTs, dur: dur };
      })
      .filter(Boolean)
      .sort(function (a, b) { return a.wakeTs - b.wakeTs; })
      .slice(-Math.max(1, days));

    if (!recs.length) {
      // No data at all: assume a neutral mid-pressure morning.
      return { S: 0.45, wakeTs: null };
    }

    let S = 0.70;                       // pressure just before the first sleep
    for (let i = 0; i < recs.length; i++) {
      S = sleepStep(S, recs[i].dur);    // sleep: pressure drops
      const next = recs[i + 1];
      if (next) {
        const awakeHrs = Math.max(0, (next.onsetTs - recs[i].wakeTs) / 3600e3);
        S = awakeStep(S, awakeHrs);     // awake: pressure rises
      }
    }
    return { S: clamp(S, 0, 1), wakeTs: recs[recs.length - 1].wakeTs };
  }

  /* ==========================================================================
   *  2–4. CIRCADIAN, AFTERNOON DIP, SLEEP INERTIA       — spec §2, §3, §4
   *     Question: "Are you an early bird, neutral, or night owl?" (+ onboarding
   *     schedule estimate) shifts the circadian phase.
   * ========================================================================*/
  function chronotypeShiftOf(chronotype) {
    return chronotype === 'early' ? -1 : chronotype === 'late' ? 1.5 : 0;
  }
  function biologicalHourOf(clockHour, chronotype, phaseShift) {
    const shift = chronotypeShiftOf(chronotype) + (phaseShift || 0);
    return ((clockHour - shift) % 24 + 24) % 24;
  }
  function circadianAlerting(biologicalHour) {
    return (1 + Math.cos((2 * Math.PI * (biologicalHour - 18)) / 24)) / 2;
  }
  function physicalCircadianAlerting(biologicalHour) {
    // Physical peak runs slightly later than the cognitive peak.
    return (1 + Math.cos((2 * Math.PI * (biologicalHour - 18.5)) / 24)) / 2;
  }
  function afternoonDipOf(biologicalHour) {
    return Math.exp(-0.5 * Math.pow((biologicalHour - 14) / 1.3, 2));
  }
  function sleepInertiaOf(hoursSinceWake) {
    return Math.exp(-Math.max(0, hoursSinceWake) / 1.0);
  }

  /* ==========================================================================
   *  5. BASE FOCUS SCORE                                — spec §5
   * ========================================================================*/
  function baseFocusScore(homeostaticAlertness, circadian, afternoonDip, sleepInertia) {
    return 100 * clamp(
      0.65 * homeostaticAlertness +
      0.35 * circadian -
      0.18 * afternoonDip -
      0.18 * sleepInertia
    );
  }

  /* ==========================================================================
   *  6. MORNING ANSWERS  ->  current reported state      — spec §6
   *     Questions: energy(1–10), sleepiness(1–9), mood(1–10), stress(1–10),
   *     physical fatigue(1–10).
   * ========================================================================*/
  function norm10(v) { return clamp((v - 1) / 9, 0, 1); }   // 1..10 -> 0..1
  function alertnessFromSleepiness(sleepiness1to9) {
    return clamp(1 - (sleepiness1to9 - 1) / 8, 0, 1);        // 1..9 -> 1..0
  }
  function currentStateOf(a) {
    const energy = norm10(a.energy);
    const mood = norm10(a.mood);
    const stress = norm10(a.stress);
    const physicalFatigue = norm10(a.physicalFatigue);
    const alert = alertnessFromSleepiness(a.sleepiness);
    return clamp(
      0.45 * energy +
      0.20 * alert +
      0.15 * mood +
      0.10 * (1 - stress) +
      0.10 * (1 - physicalFatigue)
    );
  }

  /* ==========================================================================
   *  7. PHYSICAL RECOVERY & SCORE                        — spec §7
   *     Questions: physical fatigue(1–10), soreness(1–10), sleep quality(1–10),
   *     "Are you feeling unwell?".
   * ========================================================================*/
  function illnessPenaltyOf(illness) {
    return illness === 'unwell' ? 1 : illness === 'slightly-unwell' ? 0.5 : 0;
  }
  function recoveryOf(a) {
    const physicalFatigue = norm10(a.physicalFatigue);
    const soreness = norm10(a.soreness);
    const sleepQuality = norm10(a.sleepQuality);
    const illnessPenalty = illnessPenaltyOf(a.illness);
    return clamp(
      0.35 * (1 - physicalFatigue) +
      0.30 * (1 - soreness) +
      0.25 * sleepQuality +
      0.10 * (1 - illnessPenalty)
    );
  }
  function physicalScoreOf(homeostaticAlertness, physicalCircadian, recovery, afternoonDip, sleepInertia) {
    return 100 * clamp(
      0.35 * homeostaticAlertness +
      0.45 * physicalCircadian +
      0.20 * recovery -
      0.08 * afternoonDip -
      0.10 * sleepInertia
    );
  }

  /* ==========================================================================
   *  8. OVERALL ENERGY                                   — spec §8
   * ========================================================================*/
  function overallEnergyOf(focusScore, physicalScore) {
    return 0.65 * focusScore + 0.35 * physicalScore;
  }

  /* ==========================================================================
   *  CHRONOTYPE ESTIMATE FROM ONBOARDING SCHEDULE
   *  Uses the mid-sleep point on FREE days (MSF), the standard MCTQ marker.
   *  Questions: "normal sleep & wake time on free days".
   * ========================================================================*/
  function estimateChronotype(schedule) {
    if (!schedule) return 'neutral';
    const onset = toHour(schedule.freeSleep != null ? schedule.freeSleep : schedule.workSleep);
    const wake = toHour(schedule.freeWake != null ? schedule.freeWake : schedule.workWake);
    if (onset == null || wake == null) return 'neutral';
    const dur = sleepDuration(onset, wake);
    const msf = ((onset + dur / 2) % 24 + 24) % 24; // hours after midnight
    if (msf < 3.5) return 'early';
    if (msf > 5.0) return 'late';
    return 'neutral';
  }

  /* ==========================================================================
   *  FORECAST  — one point every 30 min from wake to expected bedtime.
   *  Applies the current-state calibration (fades with distance from "now")
   *  and a 60-minute moving-average smooth.                 spec §Graph
   * ========================================================================*/
  function smooth60(values) {
    // points are 30 min apart -> a 60-min window is the centred 3-point mean.
    const out = new Array(values.length);
    for (let i = 0; i < values.length; i++) {
      let sum = 0, n = 0;
      for (let j = i - 1; j <= i + 1; j++) {
        if (j >= 0 && j < values.length) { sum += values[j]; n++; }
      }
      out[i] = sum / n;
    }
    return out;
  }

  function buildForecast(input) {
    const now = input.now || new Date();
    const nowHour = now.getHours() + now.getMinutes() / 60;
    const chronotype = input.chronotype || 'neutral';
    const learning = input.learning || { heightScale: 1, phaseShift: 0 };
    const a = input.answers || {};

    const realWake = toHour(input.wake);
    if (realWake == null) return { points: [], meta: { error: 'missing wake time' } };
    const wakeHour = Math.round(realWake * 2) / 2;   // snap to a clean 30-min grid
    const bedHour = toHour(input.expectedBedtime);
    // Expected bedtime is later the same day; if it reads earlier, it's after midnight.
    let bedAbs = bedHour == null ? wakeHour + 16 : Math.round(bedHour * 2) / 2;
    if (bedAbs <= wakeHour) bedAbs += 24;

    // Homeostatic pressure at this morning's wake (from sleep log + last night).
    const sp = sleepPressureAtWake(input.sleepLog, 7);
    const Swake = sp.S;

    const recovery = recoveryOf(a);
    const hasAnswers = a.energy != null;
    const currentState = hasAnswers ? currentStateOf(a) : null;

    // homeostatic alertness at an absolute hour h (>= wakeHour)
    function alertnessAt(h) {
      const awakeHrs = Math.max(0, h - wakeHour);
      const S = awakeStep(Swake, awakeHrs);
      return clamp(1 - S, 0, 1);
    }
    // base focus at an absolute hour (no current-state calibration yet)
    function baseFocusAt(h) {
      const clock = ((h % 24) + 24) % 24;
      const bio = biologicalHourOf(clock, chronotype, learning.phaseShift);
      return baseFocusScore(alertnessAt(h), circadianAlerting(bio), afternoonDipOf(bio), sleepInertiaOf(h - wakeHour));
    }

    const currentBaseFocus = baseFocusAt(Math.max(nowHour, wakeHour));

    const rawFocus = [], rawPhysical = [], rawOverall = [], hours = [];
    for (let h = wakeHour; h <= bedAbs + 1e-6; h += 0.5) {
      const clock = ((h % 24) + 24) % 24;
      const bio = biologicalHourOf(clock, chronotype, learning.phaseShift);
      const alert = alertnessAt(h);
      const dip = afternoonDipOf(bio);
      const inertia = sleepInertiaOf(h - wakeHour);

      // Focus + current-state calibration (spec §6)
      let focus = baseFocusScore(alert, circadianAlerting(bio), dip, inertia);
      if (currentState != null) {
        const strength = Math.exp(-Math.abs(h - nowHour) / 4);
        focus = clamp((focus + strength * (currentState * 100 - currentBaseFocus)) / 100) * 100;
      }
      // Physical (spec §7)
      const physical = physicalScoreOf(alert, physicalCircadianAlerting(bio), recovery, dip, inertia);
      // Overall (spec §8)
      const overall = overallEnergyOf(focus, physical);

      // Personal learning height scale, applied gently.
      const hs = learning.heightScale || 1;
      hours.push(clock);
      rawFocus.push(clamp(focus * hs, 0, 100));
      rawPhysical.push(clamp(physical * hs, 0, 100));
      rawOverall.push(clamp(overall * hs, 0, 100));
    }

    const sFocus = smooth60(rawFocus);
    const sPhysical = smooth60(rawPhysical);
    const sOverall = smooth60(rawOverall);

    const points = [];
    let h = wakeHour;
    for (let i = 0; i < hours.length; i++, h += 0.5) {
      points.push({
        absHour: h,
        hour: hours[i],
        label: fmtHour(hours[i]),
        focus: Math.round(sFocus[i]),
        physical: Math.round(sPhysical[i]),
        overall: Math.round(sOverall[i]),
      });
    }

    return {
      points: points,
      meta: {
        wakeHour: wakeHour, bedHour: bedAbs, nowHour: nowHour,
        chronotype: chronotype,
        homeostaticAtWake: Swake,
        recovery: recovery,
        currentState: currentState,
        hasAnswers: hasAnswers,
      },
    };
  }

  /* ==========================================================================
   *  WINDOW DETECTION                                    — spec §Detect
   * ========================================================================*/
  function mean(arr, key, from, to) {
    let s = 0, n = 0;
    for (let i = from; i <= to; i++) { s += arr[i][key]; n++; }
    return n ? s / n : 0;
  }
  function percentile(values, p) {
    const v = values.slice().sort(function (a, b) { return a - b; });
    if (!v.length) return 0;
    const idx = clamp(p, 0, 1) * (v.length - 1);
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    return v[lo] + (v[hi] - v[lo]) * (idx - lo);
  }
  function minPointsFor(minutes) { return Math.max(2, Math.ceil(minutes / 30) + 1); }

  // Grow a window around a peak while the key stays >= dropFrac * peak value.
  function expandAroundPeak(points, key, peakIdx, dropFrac, minPts, maxPts, lo, hi) {
    const peakVal = points[peakIdx][key];
    let a = peakIdx, b = peakIdx;
    while (true) {
      const canL = a - 1 >= lo && points[a - 1][key] >= dropFrac * peakVal;
      const canR = b + 1 <= hi && points[b + 1][key] >= dropFrac * peakVal;
      if ((b - a + 1) >= maxPts) break;
      if (!canL && !canR) break;
      // extend toward the higher neighbour first
      const lv = canL ? points[a - 1][key] : -1;
      const rv = canR ? points[b + 1][key] : -1;
      if (rv >= lv && canR) b++; else if (canL) a--; else break;
    }
    // ensure minimum length where possible
    while ((b - a + 1) < minPts) {
      if (b + 1 <= hi) b++; else if (a - 1 >= lo) a--; else break;
    }
    return { a: a, b: b };
  }

  function detectWindows(points, opts) {
    opts = opts || {};
    if (!points || points.length < 2) {
      return { peakEnergy: null, bestFocus: null, energyDip: null, bestWorkout: null };
    }
    const wakeHour = points[0].absHour;
    const bedHour = points[points.length - 1].absHour;
    const firstHourEnd = wakeHour + 1;     // exclude the first hour after waking

    // ── Peak energy: highest overall point (+ its 60-min section) ──
    let peakIdx = 0;
    for (let i = 1; i < points.length; i++) if (points[i].overall > points[peakIdx].overall) peakIdx = i;
    const peakWin = expandAroundPeak(points, 'overall', peakIdx, 0.97, minPointsFor(60), minPointsFor(60), 0, points.length - 1);
    const peakEnergy = {
      hour: points[peakIdx].absHour,
      start: points[peakWin.a].absHour, end: points[peakWin.b].absHour,
      value: points[peakIdx].overall,
      label: fmtHour(points[peakIdx].absHour),
    };

    // ── Best focus: highest continuous focus, >=60 min, exclude first hour ──
    let fIdx = -1;
    for (let i = 0; i < points.length; i++) {
      if (points[i].absHour < firstHourEnd) continue;
      if (fIdx < 0 || points[i].focus > points[fIdx].focus) fIdx = i;
    }
    let bestFocus = null;
    if (fIdx >= 0) {
      const loIdx = points.findIndex(function (p) { return p.absHour >= firstHourEnd; });
      const w = expandAroundPeak(points, 'focus', fIdx, 0.90, minPointsFor(60), minPointsFor(180), loIdx, points.length - 1);
      bestFocus = {
        start: points[w.a].absHour, end: points[w.b].absHour,
        value: Math.round(mean(points, 'focus', w.a, w.b)),
        label: fmtRange(points[w.a].absHour, points[w.b].absHour),
      };
    }

    // ── Energy dip: a LOCAL low (valley) where overall < 30th percentile and
    //    the run is >=45 min and flanked by higher energy on both sides ──
    const p30 = percentile(points.map(function (p) { return p.overall; }), 0.30);
    const dipMinPts = minPointsFor(45);
    const runs = [];
    let run = null;
    for (let i = 0; i <= points.length; i++) {
      const below = i < points.length && points[i].overall < p30 && points[i].absHour >= firstHourEnd;
      if (below) { if (!run) run = { a: i, b: i }; else run.b = i; }
      else { if (run && (run.b - run.a + 1) >= dipMinPts) runs.push(run); run = null; }
    }
    const runMean = function (r) { return mean(points, 'overall', r.a, r.b); };
    const isValley = function (r) {
      const m = runMean(r);
      let before = false, after = false;
      for (let i = 0; i < r.a; i++) if (points[i].overall > m + 3) { before = true; break; }
      for (let i = r.b + 1; i < points.length; i++) if (points[i].overall > m + 3) { after = true; break; }
      return before && after;       // a genuine trough, not a start/end ramp
    };
    const valleys = runs.filter(isValley);
    const pool = valleys.length ? valleys : runs;     // fall back if no valley
    let chosen = null, chosenM = Infinity;
    pool.forEach(function (r) { const m = runMean(r); if (m < chosenM) { chosenM = m; chosen = r; } });
    const dip = chosen ? {
      start: points[chosen.a].absHour, end: points[chosen.b].absHour,
      value: Math.round(runMean(chosen)), label: fmtRange(points[chosen.a].absHour, points[chosen.b].absHour),
    } : null;

    // ── Best workout: highest continuous physical, 60–120 min, with gating ──
    const sorenessHigh = opts.soreness != null && opts.soreness >= 7;   // 1..10
    const ill = opts.illness && opts.illness !== 'well';
    const recoveryOk = opts.muscleRecoveryOk !== false;
    let bestWorkout = null;
    const workoutBlocked = sorenessHigh || ill || !recoveryOk;
    if (!workoutBlocked) {
      const latestEnd = bedHour - 1.5;     // must finish >=90 min before bed
      let wIdx = -1;
      for (let i = 0; i < points.length; i++) {
        if (points[i].absHour < firstHourEnd) continue;
        if (points[i].absHour > latestEnd) continue;
        if (wIdx < 0 || points[i].physical > points[wIdx].physical) wIdx = i;
      }
      if (wIdx >= 0) {
        const loIdx = points.findIndex(function (p) { return p.absHour >= firstHourEnd; });
        let hiIdx = points.length - 1;
        while (hiIdx > 0 && points[hiIdx].absHour > latestEnd) hiIdx--;
        const w = expandAroundPeak(points, 'physical', wIdx, 0.92, minPointsFor(60), minPointsFor(120), loIdx, hiIdx);
        bestWorkout = {
          start: points[w.a].absHour, end: points[w.b].absHour,
          value: Math.round(mean(points, 'physical', w.a, w.b)),
          label: fmtRange(points[w.a].absHour, points[w.b].absHour),
        };
      }
    }

    return { peakEnergy: peakEnergy, bestFocus: bestFocus, energyDip: dip, bestWorkout: bestWorkout, workoutBlocked: workoutBlocked };
  }

  /* ==========================================================================
   *  PERSONAL LEARNING                                   — spec §Personal
   *  Stores reported-vs-predicted observations and gently nudges future peak
   *  timing (phase) and score height toward the user's real pattern.
   * ========================================================================*/
  var OBS_KEY = 'jarvis_ei_observations';

  function getObservations() {
    try { return JSON.parse(localStorage.getItem(OBS_KEY)) || []; } catch (e) { return []; }
  }
  function recordObservation(obs) {
    const list = getObservations();
    list.push(obs);
    try { localStorage.setItem(OBS_KEY, JSON.stringify(list.slice(-400))); } catch (e) {}
    return list.length;
  }

  function confidenceLabel(count) {
    if (count > 50) return 'Personalised prediction';
    if (count >= 20) return 'Moderate confidence';
    return 'Learning your rhythm';
  }

  // Derive { heightScale, phaseShift, count, label } from observations.
  function computeLearning(observations) {
    const obs = (observations || getObservations()).filter(function (o) {
      return o && o.predictedScore > 0 && o.reportedScore != null && o.hoursSinceWaking != null;
    });
    const count = obs.length;
    let heightScale = 1, phaseShift = 0;

    if (count >= 5) {
      // Height: average reported/predicted ratio, applied gradually & clamped.
      let r = 0;
      obs.forEach(function (o) { r += o.reportedScore / Math.max(1, o.predictedScore); });
      r = r / obs.length;
      const trust = Math.min(1, count / 50);
      heightScale = clamp(1 + (r - 1) * trust, 0.75, 1.25);

      // Phase: where reported energy actually peaks (hours-since-wake), bucketed,
      // vs. where it was predicted to peak — shift toward the real peak.
      const repBuckets = {}, predBuckets = {};
      obs.forEach(function (o) {
        const k = Math.round(o.hoursSinceWaking);
        repBuckets[k] = (repBuckets[k] || 0); repBuckets[k] += o.reportedScore;
        predBuckets[k] = (predBuckets[k] || 0); predBuckets[k] += o.predictedScore;
      });
      const peakBucket = function (b) {
        let best = null, bv = -Infinity;
        Object.keys(b).forEach(function (k) { if (b[k] > bv) { bv = b[k]; best = parseFloat(k); } });
        return best;
      };
      const repPeak = peakBucket(repBuckets), predPeak = peakBucket(predBuckets);
      if (repPeak != null && predPeak != null) {
        phaseShift = clamp((predPeak - repPeak) * 0.5 * trust, -2, 2);
      }
    }
    return { heightScale: heightScale, phaseShift: phaseShift, count: count, label: confidenceLabel(count) };
  }

  // ── Public API ───────────────────────────────────────────────────────────
  global.Energy = {
    // helpers
    clamp: clamp, toHour: toHour, sleepDuration: sleepDuration, fmtHour: fmtHour, fmtRange: fmtRange,
    // process pieces (exposed for testing / reuse)
    awakeStep: awakeStep, sleepStep: sleepStep, sleepPressureAtWake: sleepPressureAtWake,
    chronotypeShiftOf: chronotypeShiftOf, biologicalHourOf: biologicalHourOf,
    circadianAlerting: circadianAlerting, physicalCircadianAlerting: physicalCircadianAlerting,
    afternoonDipOf: afternoonDipOf, sleepInertiaOf: sleepInertiaOf,
    baseFocusScore: baseFocusScore, currentStateOf: currentStateOf,
    recoveryOf: recoveryOf, physicalScoreOf: physicalScoreOf, overallEnergyOf: overallEnergyOf,
    norm10: norm10, alertnessFromSleepiness: alertnessFromSleepiness, illnessPenaltyOf: illnessPenaltyOf,
    // orchestration
    estimateChronotype: estimateChronotype,
    buildForecast: buildForecast,
    detectWindows: detectWindows,
    // learning
    getObservations: getObservations, recordObservation: recordObservation,
    computeLearning: computeLearning, confidenceLabel: confidenceLabel,
  };

  // Allow Node require() for unit testing.
  if (typeof module !== 'undefined' && module.exports) module.exports = global.Energy;

})(typeof window !== 'undefined' ? window : globalThis);
