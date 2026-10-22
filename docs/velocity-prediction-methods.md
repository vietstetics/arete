# Personal velocity prediction methods

Implemented model version: `personal-v1` in `features/velocity/services/predictions.js`.
This is a proposed engineering baseline with software verification. It has no
prospective athlete validation and no claimed research-grade camera accuracy.

## Evidence and its limits

- Jukic et al. (2024), *Modeling the repetitions-in-reserve-velocity relationship*,
  studied individual and general relationships in free-weight back squats and
  tested predictions in a subsequent session. This supports investigating personal
  relationships, not importing universal coefficients or transferring their
  performance results to Arete. DOI: [10.14814/phy2.15955](https://physoc.onlinelibrary.wiley.com/doi/10.14814/phy2.15955).
- Miras-Moreno et al. (2025), *Improving the Use of Lifting Velocity to Predict
  Repetitions to Failure*, found that fatigue and training experience can affect
  predictive performance. Rest is an optional recorded feature; absent rest or
  fatigue data are not fabricated. DOI: [10.1123/ijspp.2024-0337](https://doi.org/10.1123/ijspp.2024-0337).
- Zourdos et al. (2016), *Novel Resistance Training-Specific Rating of Perceived
  Exertion Scale Measuring Repetitions in Reserve*, provides the RIR-based RPE
  framework. Arete uses `10 − RIR` only near failure and labels it an approximation
  rather than a measurement of perceived exertion. DOI:
  [10.1519/JSC.0000000000001049](https://doi.org/10.1519/JSC.0000000000001049).
- Greig et al. (2023), *The Predictive Validity of Individualised Load–Velocity
  Relationships for Predicting 1RM*, reports substantial prediction uncertainty
  across approaches. A well-fitting line alone does not establish individual
  predictive accuracy. DOI: [10.1007/s40279-023-01854-9](https://link.springer.com/article/10.1007/s40279-023-01854-9).
- Claassen et al. (2026), *Reliability, Device Agreement and Validity of
  Load–Velocity Profiles*, emphasizes sensor/exercise dependence, heterogeneity
  and limitations of agreement/error evidence. Commercial sensor evidence is not
  validation of Arete's camera pipeline. Published 3 September 2026; DOI:
  [10.1186/s40798-026-01102-0](https://link.springer.com/article/10.1186/s40798-026-01102-0).

These sources motivate the design. None establishes the multivariable ridge
model, readiness limits or uncertainty procedure below as a validated sporting
method. No paper's numerical prediction performance is claimed for this app.

## Data contract

The synchronous entry point is:

```js
predictionsForSet(record, historyRecords, {
  userId, exerciseId, equipmentId, // equipmentKey is also accepted
  source, units, metric, endpoint,
  epleySupported: false,
});
```

The result keeps `rir`, `rpe`, `oneRm` and `repetitionOneRm` separate. Each has
`status`, `estimate`, `range`, `reason` and method/version metadata where
available. Aliases `velocity1RM` and `repetition1RM` are supplied for consumers.
`profile` contains calibration status, empirical validation, coefficients and
load–velocity observations/fit. It never changes input observations or reports.

Every historical record must retain exact person, exercise variation, equipment,
source, units, metric, set ID, session ID and timestamp. Current context may fill
current identity fields; it never supplies unknown history identities. RIR also
requires an explicit `technical` or `momentary` endpoint. Strength profiles do
not require a RIR endpoint. Mean concentric and mean propulsive measurements, or
the older fixed-D velocity convention, cannot be pooled under the same metric.

Training requires `quality.accepted === true` with no invalid/camera-moved flag.
Synthetic records are excluded. Accepted relative measurements may retain a
descriptive geometry estimate flag; they use `rep.rel` and never raw native
speeds across sessions. Absolute data additionally require validated physical
calibration with a method and version and no per-rep estimate flag. A plate
diameter with assumed camera geometry does not by itself pass that gate.

Labels come from actual `reportedEffort` (including its input provenance) or a
documented `failureEndpoint`. Reported RIR labels only the final completed rep;
RPE reports from 7 to 10 can supply a separately identified approximate RIR
label. Legacy `typedRir` is used only when structured reported effort is absent.
An explicit empty report never falls back to an older scalar. Predictions never
become training labels. Verified endpoint sets label each completed rep by the
number of valid reps remaining before the documented endpoint. Any short or
unclear repetition prevents that backward labelling. Technical and momentary
failure stay separate. Subjective labels are not treated as exact ground truth.

## RIR model and validation

Features are load in kg, current velocity, decline from the fastest valid rep
seen **so far**, and completed rep position. Recorded rest seconds are included
only when all training labels have them. Missing values are never imputed.
No later rep's velocity, final set length, reported effort or failure label enters
an earlier rep's features.

Features are standardized using training data only. A linear ridge model with
an unpenalized intercept and fixed penalty `lambda = 1` is fit. Constant features
are omitted from the equation but retain their support limits. Total fitting
weight is equal per session, then per set, so a long failure set does not gain
dozens of independent votes. Coefficients are exposed in original feature units.

Evaluation walks forward by complete sessions. No same-set or same-session
random split is used. Overlapping later sessions, current session/set, future
records, and labels entered after the prediction time cannot enter training.
Out-of-support observations are refused, including unseen values of a feature
that was constant in training. Diagnostics include MAE, bias, fraction within one
rep, maximum error and the actual session folds. These are errors against the
stored labels and inherit their subjectivity.

At least three scored future-session blocks and maximum observed RIR error at
most two reps are the default engineering prerequisites. The model also needs
estimable feature/label variation and supported current measurements. These
counts and tolerances are **not** proof of calibration or sourced physiological
constants; the low-level fit API allows explicit alternatives. Cold starts,
unsupported inputs and failed error gates return unavailable.

The displayed RIR range is estimate plus/minus the largest absolute error seen
in scored held-out sessions, truncated at zero. It is an empirical error envelope,
not a confidence interval, conformal guarantee or measured future coverage. It
does not account for unseen measurement errors or endpoint mislabelling. RPE is
available only when the whole RIR envelope lies in 0–3 and is no wider than two
reps; its bounds are transformed as `[10 − upperRIR, 10 − lowerRIR]`.

## Individual load–velocity 1RM

Only explicitly maximal-intent first reps with accepted, physically calibrated
MCV are loading points. A verified successful maximal single can provide both a
loading point and a personal maximal velocity observation. Multiple observations
at the same session/load are averaged before fitting
`loadKg = intercept + slope × MCV`. At least three distinct loads and a finite
negative slope are needed. R-squared and load/velocity ranges are descriptive.

There is no universal squat/bench MVT fallback. The target MVT is the mean of
that person's documented maximal-single velocities for the same measurement
profile. If no such observation exists, velocity-based 1RM is unavailable.
Future-session evaluation predicts each subsequent maximal load from earlier
sessions' line and earlier observed maximal velocities; the test session's own
MVT never supplies its prediction target. At least two scored subsequent maximal
test sessions and worst observed relative error at most 10% are default
engineering prerequisites. Extrapolation beyond 25% of the observed velocity
span is refused. These settings await practical validation.

The kg range uses the largest observed future-session maximal-test error, with
the same noncoverage limitations as RIR. Actual tested loads remain separate
observations. Tiny changes inside the model/measurement error envelope should
not be called real strength changes. No failure or maximal testing is required
to use the logger; without suitable observations this model stays unavailable.

## Separate repetition-based estimate

The optional Epley baseline uses the requested conventional formula
`load × (1 + repetitionsToFailure / 30)`, where repetitions to failure are actual
completed reps plus actual reported RIR (or the documented failure endpoint).
A single known maximal repetition returns its actual load. It is explicitly
opt-in for an appropriate exercise and limited to 1–10 estimated reps to failure
as a conservative engineering scope. It does not silently assume zero RIR.
Manual logger counts can support this calculation without fabricated camera reps.
Tracked sets containing short or unclear attempts are refused rather than
silently filtering those attempts from a repetitions-to-failure calculation.
It has no fabricated individual uncertainty range and is never averaged with
velocity-based 1RM. Conventional equation performance depends on exercise and
population; see the original validation study by LeSuer et al. (1997),
[*The Accuracy of Prediction Equations for Estimating 1-RM Performance in the
Bench Press, Squat, and Deadlift*](https://paulogentil.com/pdf/The%20Accuracy%20of%20Prediction%20Equations%20for%20Estimating%201-RM%20Performance%20in%20the%20Bench%20Press,%20Squat,%20and%20Deadlift.pdf).

## Verification and remaining validation

`node --test features/velocity/__tests__/predictions.test.js` uses explicitly
synthetic, deterministic fixtures to check labels, equations, session/identity
separation, cold starts, support/quality gates and missing-data behavior. Test
fixture performance is mathematical/software verification, not athlete evidence.

Prospective work still needs real phone/device and reference-transducer data,
repeated independently labelled sessions, documented endpoint reliability,
separate exercises/equipment, fatigue/rest conditions, differing camera views,
and an untouched final future-session validation set. Record absolute errors,
bias and error distributions for velocity, RIR and kg; assess changes over time
against those errors. Population generalization would additionally require
held-out people. No population model is supplied.
