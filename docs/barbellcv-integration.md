# Selected barbell tracking and local BarbellCV analysis

Updated 24 October 2026.

The two requested repositories are cloned locally:

- `vendor/barbell-path-tracker`: Marticles, pinned to
  `501daea5c0666b3564fadbbebb51e6f6ac0b2428` (MIT).
- `vendor/barbellcv`: Trevor Lancon, pinned to
  `7ffcd8853a3dbfb8da2b1993f63d844d3279cd2a`. Its `setup.py` declares GPLv3;
  the checkout does not contain a full licence file. The user explicitly chose
  to keep this project as a separate local analysis tool.

No BarbellCV source is copied into Arete's browser bundle. The mobile app
contains an attributed adaptation of Marticles' **Template_Matching** mode,
not the desktop program's default Dlib tracker. The original MIT notice and
pinned source snapshot are in `features/velocity/third_party/barbell-path-tracker`.
Example media are not bundled or redistributed. Both full working Git checkouts
are ignored by Arete's Git index and excluded from the web build.

## Mobile target lock

1. Open the curl, squat or bench prototype, or a supported free-weight set from
   Training. Select **Weight tracking → Select bar / weight · Marticles tracker**.
   Machine/hand setups retain their existing measurement source.
2. Start the camera or open a video. The video pauses for imported-file
   selection. Hold the weight still and draw a tight box around a distinctive
   bar-end, weight detail or high-contrast marker. Camera mirroring and cover
   cropping are undone before passing coordinates to the tracker.
3. A successful lock displays a green rectangle. Follow the usual hold-still
   wait for pose-based rep calibration. The green path follows the selected
   point. The speed panel is hidden while drawing so it cannot intercept the
   selection gesture.
4. Short occlusions produce missing samples and may reacquire near the previous
   position. An ambiguous match, indistinct selection, long dropout, changed
   resolution or out-of-window jump does not become a guessed position. Select
   again before counting, or start a new set if reps have already been recorded.
5. End the set and inspect **Review set → All metrics**. Rep and ROM verdicts
   still come from Arete's existing pose rules; selected-target loss is never
   filled with a body-motion velocity. Detected phone rotation invalidates
   selected-target speeds, including after manual rep overrides.
6. The existing automatic 3D plate mode remains available as the other option.

The browser port retains the upstream selection, fixed grayscale template,
normalized zero-mean correlation (`TM_CCOEFF_NORMED`) and centre-path workflow.
It adds bounded coarse-to-fine search, immutable anchors, ambiguity and contrast
gates, frame timestamps, loss states and bounded memory. It does not run Dlib,
track scale/rotation/depth, prove identity under every occlusion, or distinguish
all camera translations from bar movement. A fixed tripod and side-on view are
needed. Phone performance and robustness still require real-device testing.

Selected-target displacement is normalized by the original box's image height.
These are relative units, **not metres**. Mean/peak vertical speed and ratios are
computed from timestamped observations with explicit missing-data and boundary
checks. MPV, power and force are not invented without physical calibration.
The 0.2-target-height movement gate is an engineering noise threshold, not a
claim about full anatomical ROM. Template measurements are not yet accepted as
validated personal-model inputs.

## BarbellCV handoff

1. After a selected-target set, use **Save path for BarbellCV**. This downloads
   an `arete-target-track-v1` JSON file with frame timestamps, image coordinates,
   missing-frame flags, original selection and the destination record ID.
2. On a computer, run the separate helper described in
   [barbellcv-local.md](barbellcv-local.md). It invokes the genuine pinned
   BarbellCV analysis routines from the local clone. Missing dependencies,
   invalid times, unobserved samples and unsupported inputs give errors rather
   than fabricated results.
3. Back on the same completed set, choose **Import BarbellCV analysis** and
   select the helper's `arete-barbellcv-analysis-v1` result. An analysis for
   another set or source revision is refused. Open the coach view to inspect
   its separate **BarbellCV local analysis** table; it is also retained in the
   saved workout and coach export.

BarbellCV computes the sample mean and peak of **2D path speed**, including
horizontal movement. Its smoothing, per-frame segmentation and endpoint rules
are different from Arete's vertical concentric timing and ROM standard. Results
are therefore comparison measurements, not interchangeable MCV values and not
new Arete counted reps. They never overwrite rep/ROM judgments or feed personal
RIR, RPE or 1RM models.

Without explicit physical marker measurements the helper reports relative
coordinates/speeds. Known marker diameter plus measured image radius can enable
estimated physical path speeds, but camera geometry, camera movement and real
accuracy remain unvalidated. The rectangle size is not silently treated as a
known physical marker. Always review the source's limitations and the helper's
warnings before interpreting a numerical output.

## Software verification

Current automated checks pass: **362 Node tests**, **11 Python adapter tests**
(including actual upstream BarbellCV execution and browser-parser acceptance),
the selected-target browser test, existing seven-exercise/analysis browser test,
and workout handoff/export browser test. The configured TypeScript check and
web packaging build also pass. None of these constitutes independent velocity
validation on a phone or against reference equipment.

Tests cover target-selection geometry, correlation matching, lighting changes,
ambiguity, occlusion, monotonic clocks, local recovery/expiration, bounded
history, known relative trajectories, missing boundaries and units. The browser
test exercises actual synthetic target pixels with mocked pose detections,
mirrored mobile selection, pose-standard reps, record persistence and coach view.
It is not a phone-camera or external-reference validation.

Commands:

```text
npm.cmd run test:velocity
node scripts/test-target-browser.mjs
node scripts/test-velocity-browser.mjs
node scripts/velocity-workout-smoke.mjs
```

The optional `test-template-video.mjs` uses only the locally cloned sample
media. Codec support and any tracking failures must be reported honestly; no
sample-video result establishes physical-velocity accuracy.

In one untuned diagnostic on the cloned Olympic-lifting clip, the tracker
accepted 39 of 225 sampled matches (17.3%), lost the target at 1.64 seconds,
and produced no reliable full-lift interval. This is a demonstrated limitation
of the fixed-template mode, not a passing real-lift accuracy result. The
mobile option is explicitly labelled experimental. Use the automatic plate
mode or a new selected target when this mode cannot keep the chosen point.
