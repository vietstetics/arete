// Velocity tracking (docs/velocity-tracking-plan.md). Build step 1: the
// validation harness. The page is velocity-lab.html.
export { VELOCITY_SOURCES, velocitySourceFor, handPointFor } from './services/sources.js';
export { savitzkyGolay, SG } from './services/smooth.js';
export { concentricTiming, setVelocities, intraSetFatigue, LEAVE_THRESHOLD, MAX_LOST } from './services/timing.js';
export { METRICS, confidence, repMetrics, G } from './services/metrics.js';
export { parseReference, agreement, compareSet, passes, accuracyTable, toCsv, TARGET_PCT, REFERENCES } from './services/compare.js';
export { LIFTS, trackerFor, trackerChoices, runPose, repWindows, analyseSet, estimateFps } from './services/pipeline.js';
// Build step 2: the weight tracker (plate / bar end, dumbbell head) and set records.
export { fromRGBA, sobel, sample } from './services/vision/image.js';
export { fitEllipse, robustEllipse, radiusAt } from './services/vision/ellipse.js';
export { viewFromEllipses, gravityFromRoll, PLATE_DIAMETER_M, MAX_OFF_AXIS_DEG } from './services/vision/geometry.js';
export { detectPlates, refineEllipse, fitCenter, lkTranslate, createPlateTracker } from './services/vision/plate.js';
export { weightSamples } from './services/weight.js';
export { buildSetRecord, buildLiveSetRecord, listSetRecords, saveSetRecord, SETS_KEY, RECORD_VERSION } from './services/record.js';
export { trackerModeFor, prepareWorkoutTracking, parseWorkoutContext, attachTrackedSet, ACTIVE_WORKOUT_KEY, canonicalExerciseId, equipmentKeyFor, predictionContextFor, profileForRecord, gatherPredictionHistory } from './services/workout.js';
