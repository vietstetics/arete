# Coach metrics and personal predictions — prototype test guide

Updated 23 October 2026. Continues the recovered tracker in commit `8a44d07`;
the existing camera, geometry, ROM rules and workout storage remain in use.

## What changed

The coach replay and saved workout views now show a shared metrics panel:
load, counted/short/unclear reps, measured reps, mean/fastest/latest velocity,
latest-versus-fastest velocity loss, original-rep comparison, fixed-ROM D/T
comparison, peak and propulsive velocity, duration, displacement, tracked ROM,
power/force where available, frame rate, quality, calibration and model versions.
An expandable table retains per-rep numbers and unavailable reasons.

The primary MCV convention is each valid rep's **own concentric displacement /
concentric duration**. The previous original-standard distance / duration is
retained separately as `standardizedMcv`. New records are version 2 with an
explicit convention; historical version-1 records are preserved, not relabelled
as interchangeable model inputs. Primary loss compares the latest valid rep
with the fastest valid rep in that entire set. Short and unclear reps never
contribute velocities to that comparison.

Reported RIR/RPE, documented failure endpoint, successful tested 1RM, derived
measurements and model outputs have separate fields. Review edits retain both
reported values even when they disagree; predictions do not overwrite either.
Optional labels never require a failure set or a maximal attempt.

Personal models and their guards are implemented in `predictions.js`:

- RIR: interpretable, session-weighted ridge regression on the person's own
  labelled exercise/equipment history. Whole-session chronological validation,
  support checks, quality gates and empirical held-out error envelopes govern
  availability. No universal velocity-to-RIR coefficients are used.
- RPE: approximate `10 − RIR`, only when the supported RIR envelope is narrow
  and wholly near failure. It is not measured perceived exertion.
- Velocity 1RM: an individual load–MCV line evaluated at personally observed
  maximal-single velocity, with subsequent maximal-test error checks. No
  generic exercise MVT is assumed. Unvalidated camera geometry cannot supply
  a physically validated model input.
- Repetition 1RM: a separate, opt-in Epley formula with explicit effort and
  repetition-range assumptions. It is never blended with velocity 1RM; short
  or unclear tracked attempts prevent this calculation.

See [velocity-prediction-methods.md](velocity-prediction-methods.md) for verified
literature, exact data contract, readiness settings, equations and limitations.
Engineering thresholds are not claims of physiological validity or confidence
coverage. The current phone camera still supplies estimates, not independently
validated physical velocity.

## Test on your phone

1. Open the updated prototype and refresh/reopen it so the new service worker
   and local modules load. Sign in to your existing account.
2. On the dashboard, open a rep-counter prototype (curl, squat, bench, pull-up
   or T-bar). Alternatively, open **Training**, start a workout, add a supported
   exercise and use **Track reps with camera** for the intended set.
3. Enter the set's load. For a personal profile, use a stable, explicit
   **Equipment / setup ID** for the exact variation; distinct machines or
   setups need distinct IDs. Missing identity safely prevents model fitting.
4. For squat/bench plate tracking, enter the known outer plate diameter only
   if known. Otherwise leave it blank for relative results. Keep the phone
   still, the lifter and whole plate visible, and allow camera access. Allow
   motion access if offered. Follow the existing phone-placement guide.
5. Hold still until ready, complete a set and tap **End set**. Try pauses and
   an intentionally short rep in a suitable test set; short/unclear reps should
   retain their place without accepted speed. This is a software test, not a
   reason to use a risky load or deliberately train to failure.
6. Optionally enter reported RIR and/or RPE. In **Optional personal calibration
   labels**, select the intended RIR endpoint. Verify it was reached only if
   that actually happened. Mark maximal speed intent or a successful maximal
   single only when true. The repetition-based formula is separately opt-in.
7. Tap **Review set (coach view)**, then **All metrics ↓**. Scroll the lower
   panel through the summary and four prediction cards. Expand **Every rep**
   for the measurement, ROM, time, loss and quality table. Swipe horizontally
   inside the table to inspect all columns. The replay chart remains available
   above it; comments, flags and review actions still work.
8. With no suitable history, expected prediction output is **Unavailable**
   plus a reason. Relative/native speeds must not appear as numeric m/s.
   A recorded load must not appear as an actual tested 1RM unless explicitly
   verified for one successful full rep. Changing **Next set** load must not
   alter the completed set's captured load.
9. If launched from Training, return to the workout and inspect the correct
   set's metrics. Mark the set done and finish the workout as usual. Review
   History, the exercise progression view, and coach export. Reported effort,
   metrics, model snapshots and optional labels should remain attached.
10. In exercise progression, inspect **Personal strength profile**. Actual
    tested loads, optional repetition estimates and velocity predictions remain
    separate. The load–velocity scatter appears only when real eligible loading
    observations exist; missing calibration/history gets a reason instead.

For repeatable computer demonstrations use `curl-lab.html?demo=1&ex=squat`
(or curl/bench/row/press/tbar/pullup), then Start camera. These synthetic demos
do not save personal training history or train prediction models. The offline
analysis demonstration is `velocity-lab.html?demo=1`.

## Verification and boundaries

Final verification: **321/321 automated tests passed**, including 18 prediction
tests and seven shared presenter tests. Both mobile headless-browser scripts,
the configured TypeScript check, static web build and whitespace check passed.

Automated tests cover equations, rep/ROM/timestamp behavior, original-reference
handling, unit suppression, accepted and rejected metrics, model labels,
whole-session leakage, late-entered labels, personal identity, cold starts,
regression, empirical-error gates, reports, exports and model unavailability.
Headless mobile-browser checks cover the coach metrics, independent reports,
captured-versus-next-set load, table/layout, logger return and history/export.

These are software tests with synthetic fixtures. Real phone cameras, real
lifts, different devices/lighting/angles, reference velocity equipment and
prospective personal prediction errors still require external validation.
Rest recorded by the logger is a completion-to-camera-launch timing proxy,
not a measured physiological rest interval. Videos remain device-local;
only compact observations/measurements/reports/predictions enter workout storage.
No backend, paid dependency or data-destructive migration was introduced.
