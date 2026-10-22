# Velocity tracker recovery and verification

Updated 23 October 2026.

## Recovered work

Confirmed: the starting checkout already contained a working pose rep engine,
first-rep ROM rules, live speed panel, video review, 2D weight tracking, and
the velocity validation lab. Recent commits included `d517f6c` (validation lab),
`8d0cc52` (coach replay), and `3ddd302` (T-bar hands). Uncommitted work added
3D circle reconstruction, rim tracking, live plate sessions, synthetic scenes,
accuracy comparisons and tests. All were continued in place; no reset,
revert, or checkout was used.

Read the velocity plan, accuracy protocol, coach plan, relevant redesign
sections, Git history/diffs, local Claude configuration, and Claude's saved
`velocity-cable-validation.md` memory. No root README.md, CLAUDE.md or
AGENTS.md was present. Claude's saved note explicitly says the 3D tracker
was validated in simulation only. The interruption's precise next action
cannot be established; finishing real-video validation and workout integration
was the likely remaining work, not a confirmed session instruction.

## Implementation

The narrow implementation plan was to preserve the geometry and exercise
rules, reject incomplete measurements, lock one reference per set, connect
results through the existing workout storage, and verify mathematics and UI.

- Rep counters ignore duplicate, backward and nonfinite timestamps, avoid
  inventing reps after reacquisition, and prevent a failed first return from
  becoming the ROM standard. Exercise-specific ranges/tolerances are retained.
- Live processing uses captured frame timestamps when supplied, otherwise
  media timestamps anchored once to the sensor clock. Processing delays do
  not become frame durations. The model gets its separate monotonic clock.
- A counted original standard supplies fixed displacement D; each later
  counted rep uses D/T. Short/unclear reps receive no speed, and an unseen
  original reference is never replaced by a later rep. Pauses have no fixed
  time cutoff. Each plate lift can match at most one pose rep.
- The offline lab separates counted D/T workout results from own-distance
  plate measurements used to compare against a transducer. Saving a workout
  result never counts those validation-only measurements as reps.
- Missing data, unobserved boundaries, bad timestamp sequences, invalid
  geometry and nonfinite arithmetic fail closed. Mean, peak, timing, ROM,
  ratios and reasons remain available in stored records where measured.
- Body tracking remains relative even with entered height. A known, entered
  plate diameter enables estimated m/s; assumed camera geometry is recorded
  and labelled. Without known diameter, only relative results are shown.
- Camera errors, repeated startup, asynchronous cancellation, backgrounding,
  frame callback cleanup, object URLs, motion listeners, recorder callbacks
  and wake locks are handled. Video buffering is capped at roughly 96 MiB.
  The camera is released at set end. Detected phone rotation suppresses
  velocities and cannot be bypassed by changing a rep verdict.
- Re-locking after reps have been recorded is disabled: changing the reference
  requires a new set, keeping one ROM standard and one velocity baseline.
- Supported logger sets have a Track action. Workout, exercise, set and capture
  IDs guard the return path against stale tabs, renamed/reordered exercises,
  removed sets and newer takes. The stored draft is re-read before attachment.
  Retakes retain previous measurements; review edits update the same take.
  Counts, load, explicitly entered effort, charts and coach exports use the
  existing workout object and local storage. Capturing does not finish a set.
- The PWA precaches the local tracker modules. The external pose model/runtime
  still needs network availability or the browser's existing cache.

## Verification commands

Final run: **293/293 Node tests passed**. Both headless browser scripts passed,
as did the configured TypeScript check, web build, and whitespace check.
The exercise demos produced 5 counted / 2 short reps each; the pull-up demo
produced its expected 4 counted / 3 short reps. The offline demo counted 5 reps.

Run all Node tests with `node --test "features/*/__tests__/*.test.js"`.
Targeted scripts remain available as `npm.cmd run test:velocity` and
`npm.cmd run test:standard` on Windows.

- Synthetic tests cover known displacement/duration/peak speed, variable frame
  rates, noise, dropouts, observed boundaries, reference rejection, short ROM,
  direction changes, geometry, plate sessions, and workout/export persistence.
- `node scripts/test-velocity-browser.mjs`: isolated headless Chrome at a
  390px viewport. Exercises curl/squat/bench/row/press/T-bar/pull-up demos,
  expected rep results, relative-unit labels, coach view, offline lab demo and
  report-mode changes. Camera/model downloads are excluded.
- `node scripts/velocity-workout-smoke.mjs`: isolated headless Chrome checks
  real logger launch/return, storage refresh, charts, RIR edits, workout
  completion, coach export and history using a synthetic capture record.
- `npm.cmd run typecheck` checks the existing health TypeScript configuration;
  it is not a type check of the plain-JavaScript camera implementation.
- `npm.cmd run build:web` verifies static/native-web packaging.
- `git diff --check` checks patch whitespace. There is no configured lint task.

These checks establish software behavior on synthetic inputs, not measurement
accuracy on real lifts. The simulator and reconstruction share geometric
assumptions; low synthetic error is not independent validation.

## Remaining device and measurement validation

Do not describe this feature as transducer-equivalent or clinically/scientifically
validated. Follow `docs/velocity-accuracy.md` with real lifting videos and a
reference device before making accuracy claims. Test iPhone Safari/PWA and
Android Chrome for permissions, camera interruptions, frame throughput,
heat, memory, motion access, orientation changes and recording playback.

Known limits: phone rotation sensors cannot establish that the camera never
translated; without sensors camera movement cannot reliably be separated from
bar movement. Intrinsics, distortion, gravity inferred from recorded footage,
occlusion and a wrongly entered plate diameter remain sources of error. Peak
speed is an estimate, especially with sparse frames. RIR/load suggestions
remain unvalidated speed-based estimates and do not replace typed effort.

Live plate tracking is provided for the existing squat/bench configurations.
Curls without a tracked weight use an explicitly labelled relative body
baseline; machine/cable curls use wrist displacement when launched as hand
mode. The existing T-bar hand setup is retained. There is no new general
tracker for every dumbbell, exercise, camera angle or anatomical landmark.
Set video remains device-local and is not persisted/uploaded to the coach;
the compact measurement record is what the workout/export stores.
