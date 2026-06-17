/**
 * fitness.js — JARVIS shared fitness logic
 *
 * Exposed as window.Fitness. No dependencies.
 * All JSDoc types below map 1-to-1 to TypeScript interfaces —
 * add a build step and rename .js → .ts to migrate.
 *
 * MOCKED DATA: workout history in seedMockData() is placeholder.
 * Replace storageAdapter methods to connect a real backend.
 *
 * NOT medical advice. Recovery estimates are simplified heuristics only.
 */
(function (global) {
  'use strict';

  // ─────────────────────────────────────────────────────────────
  //  TYPE DEFINITIONS  (JSDoc — TypeScript-portable)
  // ─────────────────────────────────────────────────────────────

  /**
   * @typedef {'warmup'|'working'} SetType
   * @typedef {'kg'|'lb'} WeightUnit
   * @typedef {'recovered'|'partial'|'fatigued'|'heavy'} FatigueLevel
   * @typedef {'low'|'moderate'|'high'|'peak'} IntensityLevel
   */

  /**
   * @typedef {Object} WorkoutSet
   * @property {string}     id
   * @property {SetType}    type        — 'warmup' | 'working'
   * @property {number}     weight
   * @property {WeightUnit} unit
   * @property {number}     reps
   * @property {boolean}    completed
   * @property {string}     [rpe]       — optional rate of perceived exertion
   */

  /**
   * @typedef {Object} Exercise
   * @property {string}   id
   * @property {string}   name
   * @property {string[]} primaryMuscles    — muscle group ids
   * @property {string[]} secondaryMuscles  — contribute 0.5 sets each
   * @property {WorkoutSet[]} sets
   */

  /**
   * @typedef {Object} Workout
   * @property {string}     id
   * @property {string}     name
   * @property {number}     startedAt    — unix ms timestamp
   * @property {number}     [completedAt]— unix ms timestamp
   * @property {Exercise[]} exercises
   * @property {string}     [notes]
   */

  /**
   * @typedef {Object} MuscleGroup
   * @property {string}   id
   * @property {string}   name
   * @property {'front'|'back'|'both'} view
   * @property {string[]} relatedExercises
   */

  /**
   * @typedef {Object} MuscleRecoveryState
   * @property {string}       muscleId
   * @property {string}       muscleName
   * @property {number}       totalWorkingSets  — in 7-day window
   * @property {number}       estimatedRecoveryDays
   * @property {boolean}      highVolume         — true if > 10 sets
   * @property {number}       hoursElapsed       — since last trained
   * @property {number}       hoursNeeded        — for full recovery
   * @property {number}       recoveryPct        — 0–100, hour-gradual
   * @property {FatigueLevel} fatigueLevel
   * @property {number|null}  reportedSoreness   — 1–5, from morning check-in
   * @property {number}       combinedFatigue    — 0–100 (higher = more fatigued)
   * @property {number|null}  lastTrainedAt      — unix ms or null
   */

  /**
   * @typedef {Object} MorningCheckIn
   * @property {string}  date
   * @property {number}  sleepDuration   — hours
   * @property {number}  sleepQuality    — 1–10
   * @property {number}  mood            — 1–10
   * @property {number}  energy          — 1–10
   * @property {number}  stress          — 1–10  (higher = more stressed)
   * @property {number}  physicalFatigue — 1–10  (higher = more fatigued)
   * @property {Object.<string,number>} muscleSoreness  — muscleId → 1–5
   * @property {number}  motivation      — 1–10
   * @property {boolean} illness
   */

  /**
   * @typedef {Object} ReadinessScore
   * @property {number}         overall            — 0–100
   * @property {number}         mentalReadiness    — 0–100
   * @property {number}         physicalReadiness  — 0–100
   * @property {number}         recoveryReadiness  — 0–100
   * @property {number}         estimatedEnergy    — 0–10
   * @property {IntensityLevel} recommendedIntensity
   * @property {string}         label  — 'Excellent'|'Good'|'Fair'|'Poor'
   */

  /**
   * @typedef {Object} EnergyForecast
   * @property {number}   currentLevel    — 0–10
   * @property {number[]} hourlyForecast  — 24 values, index = hour 0–23
   * @property {number}   peakHour
   * @property {number}   peakLevel
   */

  // ─────────────────────────────────────────────────────────────
  //  MUSCLE GROUP REGISTRY
  // ─────────────────────────────────────────────────────────────

  /** @type {MuscleGroup[]} */
  const MUSCLE_GROUPS = [
    // ── Front ────────────────────────────────────────────────────
    { id: 'chest-l',      name: 'Left Pectoral',    view: 'front', relatedExercises: ['Bench Press', 'Push-Up', 'Dumbbell Fly'] },
    { id: 'chest-r',      name: 'Right Pectoral',   view: 'front', relatedExercises: ['Bench Press', 'Push-Up', 'Dumbbell Fly'] },
    { id: 'delt-front-l', name: 'Left Front Delt',  view: 'front', relatedExercises: ['Overhead Press', 'Front Raise'] },
    { id: 'delt-front-r', name: 'Right Front Delt', view: 'front', relatedExercises: ['Overhead Press', 'Front Raise'] },
    { id: 'biceps-l',     name: 'Left Biceps',      view: 'front', relatedExercises: ['Barbell Curl', 'Hammer Curl', 'Pull-Up'] },
    { id: 'biceps-r',     name: 'Right Biceps',     view: 'front', relatedExercises: ['Barbell Curl', 'Hammer Curl', 'Pull-Up'] },
    { id: 'forearm-l',    name: 'Left Forearm',     view: 'both',  relatedExercises: ["Wrist Curl", "Farmer's Carry"] },
    { id: 'forearm-r',    name: 'Right Forearm',    view: 'both',  relatedExercises: ["Wrist Curl", "Farmer's Carry"] },
    { id: 'abs',          name: 'Abdominals',       view: 'front', relatedExercises: ['Crunch', 'Plank', 'Hanging Leg Raise'] },
    { id: 'obliques-l',   name: 'Left Obliques',    view: 'front', relatedExercises: ['Russian Twist', 'Side Plank'] },
    { id: 'obliques-r',   name: 'Right Obliques',   view: 'front', relatedExercises: ['Russian Twist', 'Side Plank'] },
    { id: 'quads-l',      name: 'Left Quadriceps',  view: 'front', relatedExercises: ['Squat', 'Leg Press', 'Leg Extension'] },
    { id: 'quads-r',      name: 'Right Quadriceps', view: 'front', relatedExercises: ['Squat', 'Leg Press', 'Leg Extension'] },
    { id: 'adductors-l',  name: 'Left Adductors',   view: 'front', relatedExercises: ['Sumo Squat', 'Cable Adduction'] },
    { id: 'adductors-r',  name: 'Right Adductors',  view: 'front', relatedExercises: ['Sumo Squat', 'Cable Adduction'] },
    { id: 'calves-l',     name: 'Left Calves',      view: 'both',  relatedExercises: ['Calf Raise', 'Seated Calf Raise'] },
    { id: 'calves-r',     name: 'Right Calves',     view: 'both',  relatedExercises: ['Calf Raise', 'Seated Calf Raise'] },
    // ── Back ─────────────────────────────────────────────────────
    { id: 'traps',        name: 'Trapezius',        view: 'back',  relatedExercises: ['Shrug', 'Face Pull', 'Upright Row'] },
    { id: 'delt-rear-l',  name: 'Left Rear Delt',   view: 'back',  relatedExercises: ['Rear Delt Fly', 'Face Pull', 'Row'] },
    { id: 'delt-rear-r',  name: 'Right Rear Delt',  view: 'back',  relatedExercises: ['Rear Delt Fly', 'Face Pull', 'Row'] },
    { id: 'triceps-l',    name: 'Left Triceps',     view: 'back',  relatedExercises: ['Tricep Pushdown', 'Skull Crusher', 'Dip'] },
    { id: 'triceps-r',    name: 'Right Triceps',    view: 'back',  relatedExercises: ['Tricep Pushdown', 'Skull Crusher', 'Dip'] },
    { id: 'upper-back',   name: 'Upper Back',       view: 'back',  relatedExercises: ['Row', 'Pull-Up', 'Face Pull'] },
    { id: 'lats-l',       name: 'Left Lat',         view: 'back',  relatedExercises: ['Pull-Up', 'Lat Pulldown', 'Row'] },
    { id: 'lats-r',       name: 'Right Lat',        view: 'back',  relatedExercises: ['Pull-Up', 'Lat Pulldown', 'Row'] },
    { id: 'lower-back',   name: 'Lower Back',       view: 'back',  relatedExercises: ['Deadlift', 'Romanian Deadlift', 'Good Morning'] },
    { id: 'glutes-l',     name: 'Left Glutes',      view: 'back',  relatedExercises: ['Hip Thrust', 'Deadlift', 'Squat'] },
    { id: 'glutes-r',     name: 'Right Glutes',     view: 'back',  relatedExercises: ['Hip Thrust', 'Deadlift', 'Squat'] },
    { id: 'hamstrings-l', name: 'Left Hamstrings',  view: 'back',  relatedExercises: ['Romanian Deadlift', 'Leg Curl'] },
    { id: 'hamstrings-r', name: 'Right Hamstrings', view: 'back',  relatedExercises: ['Romanian Deadlift', 'Leg Curl'] },
  ];

  // ─────────────────────────────────────────────────────────────
  //  EXERCISE → MUSCLE GROUP MAP
  // ─────────────────────────────────────────────────────────────

  const EXERCISE_MUSCLES = {
    'Bench Press':       { primary: ['chest-l','chest-r'],           secondary: ['delt-front-l','delt-front-r','triceps-l','triceps-r'] },
    'Incline Bench':     { primary: ['chest-l','chest-r'],           secondary: ['delt-front-l','delt-front-r','triceps-l','triceps-r'] },
    'Dumbbell Fly':      { primary: ['chest-l','chest-r'],           secondary: ['delt-front-l','delt-front-r'] },
    'Push-Up':           { primary: ['chest-l','chest-r'],           secondary: ['triceps-l','triceps-r','delt-front-l','delt-front-r'] },
    'Overhead Press':    { primary: ['delt-front-l','delt-front-r'], secondary: ['triceps-l','triceps-r','traps'] },
    'Lateral Raise':     { primary: ['delt-front-l','delt-front-r','delt-rear-l','delt-rear-r'], secondary: [] },
    'Front Raise':       { primary: ['delt-front-l','delt-front-r'], secondary: [] },
    'Rear Delt Fly':     { primary: ['delt-rear-l','delt-rear-r'],   secondary: ['upper-back','traps'] },
    'Face Pull':         { primary: ['delt-rear-l','delt-rear-r','upper-back'], secondary: ['traps','biceps-l','biceps-r'] },
    'Pull-Up':           { primary: ['lats-l','lats-r'],             secondary: ['biceps-l','biceps-r','upper-back'] },
    'Lat Pulldown':      { primary: ['lats-l','lats-r'],             secondary: ['biceps-l','biceps-r','upper-back'] },
    'Barbell Row':       { primary: ['lats-l','lats-r','upper-back'],secondary: ['delt-rear-l','delt-rear-r','biceps-l','biceps-r'] },
    'Cable Row':         { primary: ['lats-l','lats-r','upper-back'],secondary: ['delt-rear-l','delt-rear-r','biceps-l','biceps-r'] },
    'Deadlift':          { primary: ['lower-back','glutes-l','glutes-r','hamstrings-l','hamstrings-r'], secondary: ['traps','lats-l','lats-r','quads-l','quads-r'] },
    'Romanian Deadlift': { primary: ['hamstrings-l','hamstrings-r','glutes-l','glutes-r'], secondary: ['lower-back'] },
    'Good Morning':      { primary: ['hamstrings-l','hamstrings-r','lower-back'], secondary: ['glutes-l','glutes-r'] },
    'Shrug':             { primary: ['traps'],                       secondary: [] },
    'Upright Row':       { primary: ['traps','delt-front-l','delt-front-r'], secondary: ['biceps-l','biceps-r'] },
    'Barbell Curl':      { primary: ['biceps-l','biceps-r'],         secondary: ['forearm-l','forearm-r'] },
    'Hammer Curl':       { primary: ['biceps-l','biceps-r'],         secondary: ['forearm-l','forearm-r'] },
    "Preacher Curl":     { primary: ['biceps-l','biceps-r'],         secondary: [] },
    'Tricep Pushdown':   { primary: ['triceps-l','triceps-r'],       secondary: [] },
    'Skull Crusher':     { primary: ['triceps-l','triceps-r'],       secondary: [] },
    'Dip':               { primary: ['triceps-l','triceps-r'],       secondary: ['chest-l','chest-r','delt-front-l','delt-front-r'] },
    'Plank':             { primary: ['abs'],                         secondary: ['obliques-l','obliques-r'] },
    'Crunch':            { primary: ['abs'],                         secondary: [] },
    'Russian Twist':     { primary: ['obliques-l','obliques-r'],     secondary: ['abs'] },
    'Hanging Leg Raise': { primary: ['abs'],                         secondary: ['obliques-l','obliques-r'] },
    'Side Plank':        { primary: ['obliques-l','obliques-r'],     secondary: ['abs'] },
    'Squat':             { primary: ['quads-l','quads-r'],           secondary: ['glutes-l','glutes-r','hamstrings-l','hamstrings-r'] },
    'Leg Press':         { primary: ['quads-l','quads-r'],           secondary: ['glutes-l','glutes-r'] },
    'Leg Extension':     { primary: ['quads-l','quads-r'],           secondary: [] },
    'Leg Curl':          { primary: ['hamstrings-l','hamstrings-r'], secondary: [] },
    'Hip Thrust':        { primary: ['glutes-l','glutes-r'],         secondary: ['hamstrings-l','hamstrings-r'] },
    'Calf Raise':        { primary: ['calves-l','calves-r'],         secondary: [] },
    'Seated Calf Raise': { primary: ['calves-l','calves-r'],         secondary: [] },
    'Lunge':             { primary: ['quads-l','quads-r','glutes-l','glutes-r'], secondary: ['hamstrings-l','hamstrings-r'] },
    "Farmer's Carry":    { primary: ['forearm-l','forearm-r','traps'], secondary: [] },
    'Sumo Squat':        { primary: ['quads-l','quads-r','adductors-l','adductors-r'], secondary: ['glutes-l','glutes-r'] },
    'Cable Adduction':   { primary: ['adductors-l','adductors-r'],   secondary: [] },
  };

  // Sorted exercise names for autocomplete
  const EXERCISE_NAMES = Object.keys(EXERCISE_MUSCLES).sort();

  // ─────────────────────────────────────────────────────────────
  //  RECOVERY CALCULATION FUNCTIONS  (pure — no side effects)
  // ─────────────────────────────────────────────────────────────

  /**
   * Estimate recovery days needed from completed working set count.
   * Only counts completed working sets; excludes warm-ups.
   * @param {number} workingSets
   * @returns {{ days: number, highVolume: boolean }}
   */
  function getRecoveryDaysFromSets(workingSets) {
    if (workingSets === 0)  return { days: 0, highVolume: false };
    if (workingSets <= 3)   return { days: 1, highVolume: false };
    if (workingSets <= 5)   return { days: 2, highVolume: false };
    if (workingSets <= 7)   return { days: 3, highVolume: false };
    if (workingSets <= 10)  return { days: 4, highVolume: false };
    return { days: 5, highVolume: true }; // cap at 5, flag high volume
  }

  /**
   * Calculate elapsed time vs time needed for full recovery.
   * Recovery improves hour-by-hour, not at midnight.
   * @param {number} lastTrainedAt  unix ms
   * @param {number} recoveryDays
   * @returns {{ hoursElapsed: number, hoursNeeded: number }}
   */
  function calculateElapsedRecovery(lastTrainedAt, recoveryDays) {
    const hoursElapsed = (Date.now() - lastTrainedAt) / 3_600_000;
    const hoursNeeded  = recoveryDays * 24;
    return { hoursElapsed, hoursNeeded };
  }

  /**
   * Recovery percentage 0–100, gradual (not midnight-snapping).
   * @param {number} hoursElapsed
   * @param {number} hoursNeeded
   * @returns {number}
   */
  function calculateRecoveryPercentage(hoursElapsed, hoursNeeded) {
    if (hoursNeeded === 0) return 100;
    return Math.min(100, Math.round((hoursElapsed / hoursNeeded) * 100));
  }

  /**
   * Classify fatigue level from recovery percentage.
   * @param {number} recoveryPct
   * @returns {FatigueLevel}
   */
  function calculateFatigueLevel(recoveryPct) {
    if (recoveryPct >= 90) return 'recovered';
    if (recoveryPct >= 55) return 'partial';
    if (recoveryPct >= 25) return 'fatigued';
    return 'heavy';
  }

  /**
   * Blend workout-calculated fatigue with user-reported soreness.
   * Soreness supplements the calculation — it can raise the estimate
   * upward but not lower it significantly (respects workout data).
   * @param {number}      recoveryPct      — 0–100
   * @param {number|null} reportedSoreness — 1–5 scale or null
   * @returns {number} combinedFatigue 0–100 (higher = more fatigued)
   */
  function combineWorkoutFatigueWithReportedSoreness(recoveryPct, reportedSoreness) {
    const calcFatigue = 100 - recoveryPct;
    if (reportedSoreness == null) return calcFatigue;
    // Convert 1–5 soreness to 0–100 fatigue equivalent
    const sorenessAsFatigue = ((reportedSoreness - 1) / 4) * 100;
    // Weighted blend: favour calculated value, but soreness can push it higher
    const blended = Math.max(calcFatigue, sorenessAsFatigue) * 0.75 +
                    Math.min(calcFatigue, sorenessAsFatigue) * 0.25;
    return Math.min(100, Math.round(blended));
  }

  /**
   * Compute full MuscleRecoveryState for one muscle from all workouts.
   * @param {string}           muscleId
   * @param {Workout[]}        workouts
   * @param {MorningCheckIn|null} latestCheckin
   * @returns {MuscleRecoveryState}
   */
  function getMuscleRecoveryState(muscleId, workouts, latestCheckin) {
    const muscle       = MUSCLE_GROUPS.find(m => m.id === muscleId);
    const muscleName   = muscle ? muscle.name : muscleId;
    const windowMs     = 7 * 24 * 3_600_000; // 7-day rolling window
    const since        = Date.now() - windowMs;

    let totalWorkingSets = 0;
    let lastTrainedAt    = null;

    workouts.forEach(w => {
      if (!w.completedAt || w.completedAt < since) return;
      w.exercises.forEach(ex => {
        const isPrimary   = ex.primaryMuscles.includes(muscleId);
        const isSecondary = ex.secondaryMuscles.includes(muscleId);
        if (!isPrimary && !isSecondary) return;
        const weight = isSecondary && !isPrimary ? 0.5 : 1;
        ex.sets.forEach(s => {
          if (s.type === 'working' && s.completed) {
            totalWorkingSets += weight;
            if (!lastTrainedAt || w.completedAt > lastTrainedAt) {
              lastTrainedAt = w.completedAt;
            }
          }
        });
      });
    });

    totalWorkingSets = Math.round(totalWorkingSets);
    const { days: estimatedRecoveryDays, highVolume } = getRecoveryDaysFromSets(totalWorkingSets);

    let hoursElapsed = 0, hoursNeeded = 0, recoveryPct = 100;
    if (lastTrainedAt) {
      const elapsed = calculateElapsedRecovery(lastTrainedAt, estimatedRecoveryDays);
      hoursElapsed  = elapsed.hoursElapsed;
      hoursNeeded   = elapsed.hoursNeeded;
      recoveryPct   = calculateRecoveryPercentage(hoursElapsed, hoursNeeded);
    }

    const fatigueLevel      = calculateFatigueLevel(recoveryPct);
    const reportedSoreness  = latestCheckin?.muscleSoreness?.[muscleId] ?? null;
    const combinedFatigue   = combineWorkoutFatigueWithReportedSoreness(recoveryPct, reportedSoreness);

    return {
      muscleId, muscleName, totalWorkingSets, estimatedRecoveryDays, highVolume,
      hoursElapsed, hoursNeeded, recoveryPct, fatigueLevel,
      reportedSoreness, combinedFatigue, lastTrainedAt,
    };
  }

  // ─────────────────────────────────────────────────────────────
  //  MORNING CHECK-IN SCORING  (pure)
  // ─────────────────────────────────────────────────────────────

  /**
   * Derive ReadinessScore from a MorningCheckIn.
   * Scores are heuristic estimates, not clinical measurements.
   * @param {MorningCheckIn} c
   * @returns {ReadinessScore}
   */
  function calculateMorningScore(c) {
    const clamp = v => Math.max(0, Math.min(1, v));

    // Normalise sleep duration: 4h → ~1, 8h → 10
    const sleepScore = Math.min(10, Math.max(1, (c.sleepDuration - 4) * 2));
    const stressInv  = 11 - c.stress;         // high stress → low readiness
    const fatInv     = 11 - c.physicalFatigue; // high fatigue → low readiness

    const physicalReadiness  = Math.round(clamp((c.energy * 0.35 + fatInv * 0.35 + sleepScore * 0.30) / 10) * 100);
    const mentalReadiness    = Math.round(clamp((c.mood * 0.40 + stressInv * 0.35 + c.motivation * 0.25) / 10) * 100);
    const recoveryReadiness  = Math.round(clamp((c.sleepQuality * 0.40 + sleepScore * 0.35 + fatInv * 0.25) / 10) * 100);

    let overall = Math.round(physicalReadiness * 0.40 + mentalReadiness * 0.30 + recoveryReadiness * 0.30);
    if (c.illness) overall = Math.min(overall, 35); // illness hard cap

    const estimatedEnergy = Math.round(
      (c.energy * 0.5 + (overall / 100) * 10 * 0.5) * 10
    ) / 10;

    let recommendedIntensity, label;
    if      (overall >= 80) { recommendedIntensity = 'peak';     label = 'Excellent'; }
    else if (overall >= 65) { recommendedIntensity = 'high';     label = 'Good'; }
    else if (overall >= 45) { recommendedIntensity = 'moderate'; label = 'Fair'; }
    else                    { recommendedIntensity = 'low';      label = 'Poor'; }

    return { overall, mentalReadiness, physicalReadiness, recoveryReadiness, estimatedEnergy, recommendedIntensity, label };
  }

  // ─────────────────────────────────────────────────────────────
  //  WORKOUT RECOMMENDATIONS  (pure)
  // ─────────────────────────────────────────────────────────────

  /**
   * Return muscle ids that are ready to train (recoveryPct >= 85).
   * @param {MuscleRecoveryState[]} states
   * @returns {string[]}
   */
  function getReadyMuscles(states) {
    return states.filter(s => s.recoveryPct >= 85).map(s => s.muscleId);
  }

  /**
   * Suggest a workout name based on which muscles are ready.
   * @param {string[]} readyMuscleIds
   * @returns {string}
   */
  function suggestWorkoutName(readyMuscleIds) {
    const has = id => readyMuscleIds.includes(id);
    if (has('chest-l') && has('delt-front-l') && has('triceps-l')) return 'Push Day';
    if (has('lats-l') && has('biceps-l'))                           return 'Pull Day';
    if (has('quads-l') && has('hamstrings-l'))                      return 'Leg Day';
    if (has('abs') && has('obliques-l'))                            return 'Core Session';
    return 'Full Body';
  }

  // ─────────────────────────────────────────────────────────────
  //  COLOUR MAPPING
  // ─────────────────────────────────────────────────────────────

  /**
   * Map combined fatigue (0–100) to a CSS fill colour.
   * @param {number}  combinedFatigue
   * @param {boolean} [noData]
   * @returns {{ fill: string, stroke: string, label: string }}
   */
  function fatigueToColor(combinedFatigue, noData) {
    if (noData) return { fill: '#D1D1D6', stroke: '#AEAEB2', label: 'No data' };
    if (combinedFatigue <= 15) return { fill: '#1DA462', stroke: '#158A50', label: 'Ready' };
    if (combinedFatigue <= 40) return { fill: '#3BC47A', stroke: '#2A9E5E', label: 'Mostly recovered' };
    if (combinedFatigue <= 60) return { fill: '#B07D28', stroke: '#8A6120', label: 'Partial recovery' };
    if (combinedFatigue <= 80) return { fill: '#C0552A', stroke: '#963E1E', label: 'Fatigued' };
    return                            { fill: '#C0403A', stroke: '#9A2E2A', label: 'Heavy fatigue' };
  }

  // ─────────────────────────────────────────────────────────────
  //  STORAGE ADAPTER
  //  Swap these implementations to connect a real backend.
  // ─────────────────────────────────────────────────────────────

  const storageAdapter = {
    /** @returns {Workout[]} */
    getWorkouts() {
      try { return JSON.parse(localStorage.getItem('jarvis_workouts') || '[]'); }
      catch { return []; }
    },
    /** @param {Workout} workout */
    saveWorkout(workout) {
      const list = storageAdapter.getWorkouts();
      const idx  = list.findIndex(w => w.id === workout.id);
      if (idx >= 0) list[idx] = workout; else list.unshift(workout);
      localStorage.setItem('jarvis_workouts', JSON.stringify(list));
    },
    /** @param {string} id */
    deleteWorkout(id) {
      const list = storageAdapter.getWorkouts().filter(w => w.id !== id);
      localStorage.setItem('jarvis_workouts', JSON.stringify(list));
    },
    /** @returns {MorningCheckIn|null} */
    getLatestCheckin() {
      try { return JSON.parse(localStorage.getItem('jarvis_checkin') || 'null'); }
      catch { return null; }
    },
  };

  // ─────────────────────────────────────────────────────────────
  //  MOCK DATA SEEDER
  //  MOCKED: all workout history below is placeholder data.
  //  Skipped automatically once real workouts exist.
  // ─────────────────────────────────────────────────────────────

  function seedMockData() {
    if (storageAdapter.getWorkouts().length > 0) return;

    const now = Date.now();
    const daysAgo = d => now - d * 86_400_000;

    /** @type {Workout[]} */
    const mocks = [
      {
        id: 'mock-push-1', name: 'Push Day', startedAt: daysAgo(1) - 3_600_000, completedAt: daysAgo(1), notes: '',
        exercises: [
          { id: 'mp1e1', name: 'Bench Press',     primaryMuscles: ['chest-l','chest-r'],           secondaryMuscles: ['delt-front-l','delt-front-r','triceps-l','triceps-r'],
            sets: [
              { id: 's1',  type: 'warmup',  weight: 60,  unit: 'kg', reps: 10, completed: true },
              { id: 's2',  type: 'working', weight: 85,  unit: 'kg', reps: 8,  completed: true },
              { id: 's3',  type: 'working', weight: 85,  unit: 'kg', reps: 8,  completed: true },
              { id: 's4',  type: 'working', weight: 85,  unit: 'kg', reps: 7,  completed: true },
              { id: 's5',  type: 'working', weight: 80,  unit: 'kg', reps: 8,  completed: true },
            ] },
          { id: 'mp1e2', name: 'Overhead Press',  primaryMuscles: ['delt-front-l','delt-front-r'], secondaryMuscles: ['triceps-l','triceps-r','traps'],
            sets: [
              { id: 's6',  type: 'warmup',  weight: 40,  unit: 'kg', reps: 10, completed: true },
              { id: 's7',  type: 'working', weight: 57,  unit: 'kg', reps: 8,  completed: true },
              { id: 's8',  type: 'working', weight: 57,  unit: 'kg', reps: 7,  completed: true },
              { id: 's9',  type: 'working', weight: 55,  unit: 'kg', reps: 7,  completed: true },
            ] },
          { id: 'mp1e3', name: 'Tricep Pushdown', primaryMuscles: ['triceps-l','triceps-r'],       secondaryMuscles: [],
            sets: [
              { id: 's10', type: 'working', weight: 35,  unit: 'kg', reps: 12, completed: true },
              { id: 's11', type: 'working', weight: 35,  unit: 'kg', reps: 12, completed: true },
              { id: 's12', type: 'working', weight: 35,  unit: 'kg', reps: 10, completed: true },
            ] },
        ],
      },
      {
        id: 'mock-legs-1', name: 'Leg Day', startedAt: daysAgo(3) - 4_200_000, completedAt: daysAgo(3), notes: '',
        exercises: [
          { id: 'ml1e1', name: 'Squat',             primaryMuscles: ['quads-l','quads-r'],           secondaryMuscles: ['glutes-l','glutes-r','hamstrings-l','hamstrings-r'],
            sets: [
              { id: 's13', type: 'warmup',  weight: 60,  unit: 'kg', reps: 10, completed: true },
              { id: 's14', type: 'working', weight: 105, unit: 'kg', reps: 5,  completed: true },
              { id: 's15', type: 'working', weight: 105, unit: 'kg', reps: 5,  completed: true },
              { id: 's16', type: 'working', weight: 105, unit: 'kg', reps: 4,  completed: true },
              { id: 's17', type: 'working', weight: 100, unit: 'kg', reps: 5,  completed: true },
            ] },
          { id: 'ml1e2', name: 'Romanian Deadlift', primaryMuscles: ['hamstrings-l','hamstrings-r','glutes-l','glutes-r'], secondaryMuscles: ['lower-back'],
            sets: [
              { id: 's18', type: 'working', weight: 85,  unit: 'kg', reps: 10, completed: true },
              { id: 's19', type: 'working', weight: 85,  unit: 'kg', reps: 10, completed: true },
              { id: 's20', type: 'working', weight: 85,  unit: 'kg', reps: 9,  completed: true },
            ] },
          { id: 'ml1e3', name: 'Calf Raise',        primaryMuscles: ['calves-l','calves-r'],         secondaryMuscles: [],
            sets: [
              { id: 's21', type: 'working', weight: 50,  unit: 'kg', reps: 15, completed: true },
              { id: 's22', type: 'working', weight: 50,  unit: 'kg', reps: 15, completed: true },
              { id: 's23', type: 'working', weight: 50,  unit: 'kg', reps: 12, completed: true },
            ] },
        ],
      },
      {
        id: 'mock-pull-1', name: 'Pull Day', startedAt: daysAgo(5) - 3_600_000, completedAt: daysAgo(5), notes: '',
        exercises: [
          { id: 'ml2e1', name: 'Pull-Up',     primaryMuscles: ['lats-l','lats-r'],                  secondaryMuscles: ['biceps-l','biceps-r','upper-back'],
            sets: [
              { id: 's24', type: 'working', weight: 0,   unit: 'kg', reps: 8,  completed: true },
              { id: 's25', type: 'working', weight: 0,   unit: 'kg', reps: 8,  completed: true },
              { id: 's26', type: 'working', weight: 0,   unit: 'kg', reps: 6,  completed: true },
            ] },
          { id: 'ml2e2', name: 'Barbell Row', primaryMuscles: ['lats-l','lats-r','upper-back'],      secondaryMuscles: ['delt-rear-l','delt-rear-r','biceps-l','biceps-r'],
            sets: [
              { id: 's27', type: 'warmup',  weight: 50,  unit: 'kg', reps: 10, completed: true },
              { id: 's28', type: 'working', weight: 82,  unit: 'kg', reps: 8,  completed: true },
              { id: 's29', type: 'working', weight: 82,  unit: 'kg', reps: 8,  completed: true },
              { id: 's30', type: 'working', weight: 82,  unit: 'kg', reps: 7,  completed: true },
            ] },
          { id: 'ml2e3', name: 'Barbell Curl',primaryMuscles: ['biceps-l','biceps-r'],              secondaryMuscles: ['forearm-l','forearm-r'],
            sets: [
              { id: 's31', type: 'working', weight: 42,  unit: 'kg', reps: 10, completed: true },
              { id: 's32', type: 'working', weight: 42,  unit: 'kg', reps: 10, completed: true },
              { id: 's33', type: 'working', weight: 40,  unit: 'kg', reps: 9,  completed: true },
            ] },
        ],
      },
    ];

    localStorage.setItem('jarvis_workouts', JSON.stringify(mocks));
  }

  // ─────────────────────────────────────────────────────────────
  //  UTILITY
  // ─────────────────────────────────────────────────────────────

  /** Generate a short random id. */
  function uid() { return Math.random().toString(36).slice(2, 10); }

  /** Format a unix ms timestamp as "Jun 17" */
  function fmtDate(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  /** Format elapsed hours as "2h 15m ago" or "3 days ago" */
  function fmtElapsed(hoursElapsed) {
    if (hoursElapsed < 1)   return 'Just now';
    if (hoursElapsed < 24)  return `${Math.floor(hoursElapsed)}h ago`;
    const days = Math.floor(hoursElapsed / 24);
    return `${days} day${days !== 1 ? 's' : ''} ago`;
  }

  /** Format hours remaining as "~18h left" or "Ready" */
  function fmtRemaining(hoursElapsed, hoursNeeded) {
    const remaining = hoursNeeded - hoursElapsed;
    if (remaining <= 0) return 'Ready';
    if (remaining < 24) return `~${Math.ceil(remaining)}h left`;
    return `~${Math.ceil(remaining / 24)}d left`;
  }

  // ─────────────────────────────────────────────────────────────
  //  PUBLIC API  (window.Fitness)
  // ─────────────────────────────────────────────────────────────

  global.Fitness = {
    // Registries
    MUSCLE_GROUPS,
    EXERCISE_MUSCLES,
    EXERCISE_NAMES,
    // Pure calculation functions
    getRecoveryDaysFromSets,
    calculateElapsedRecovery,
    calculateRecoveryPercentage,
    calculateFatigueLevel,
    combineWorkoutFatigueWithReportedSoreness,
    getMuscleRecoveryState,
    calculateMorningScore,
    getReadyMuscles,
    suggestWorkoutName,
    fatigueToColor,
    // Storage (swap to connect real backend)
    storageAdapter,
    // Data seeding
    seedMockData,
    // Utilities
    uid,
    fmtDate,
    fmtElapsed,
    fmtRemaining,
  };

})(window);
