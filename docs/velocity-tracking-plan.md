# Velocity tracking on a phone — research findings and recommended approach

## Context
Goal: an accurate, placement-independent velocity graph per rep inside Arete's
Start Workout, so reps are auto-counted and standardised and long-term velocity
trends tell the lifter when to add weight or reps (RIR stays user-entered).
The user asked whether ARKit/LiDAR + trigonometry is the best route, or whether
there's a better proven way. No code changes requested yet — this is the
research answer and the approach to build when ready.

## What the research shows
1. **Validated phone apps track the BARBELL, not the body.** Metric VBT (patented
   bar-end computer vision) and Qwik VBT track the bar/plate end from a side
   view. Qwik VBT matched or beat a linear transducer on mean concentric
   velocity in squat/bench/deadlift (Renner et al., PLOS ONE 2024); Metric was
   only comparable on bench. Metric reports reliability within ±25° of
   side-on, >95% rep detection, RoM limits of agreement ~±5 cm.
2. **Pose/skeleton tracking is weaker for velocity**, especially bench: a recent
   markerless-pose study found only ~74% usable frames on bench (bar occludes
   wrists, lying posture). Best for upright lifts with visible limbs.
3. **IMUs (sensor on the bar or wrist) are the most placement-proof.** 7 of 8 IMU
   devices were valid/reliable in a systematic review (Clemente 2021). A
   bar-mounted or even wrist-worn **Apple Watch** matched the Enode/Vmaxpro on
   mean squat velocity vs Vicon (Achermann 2023).
4. **ARKit body tracking**: tracks movement well but under-reports full joint
   range (Reimer 2021). No published validation for barbell velocity — it would
   be unproven territory.

## Measurement rule (decided by the user — follow exactly)
Where the velocity graph measures depends on the kind of exercise:

| Exercise type | Examples | Measure velocity at |
|---|---|---|
| **Machines / cables** — the body stays still and you deliberately move a handle | Chest press, tricep pushdown, lat pulldown, cable row, pec deck, cable curl, leg extension*, leg curl* | **The hand** (wrist/grip point) — always |
| **Free weights** — dumbbells or barbells | Bench press, squat, deadlift, RDL, overhead press, barbell row, dumbbell curl, dumbbell press | **The weight** — barbell plate/bar end, or the dumbbell head |

- Each exercise in the library gets a `velocitySource: 'hand' | 'weight'` field
  (set once per exercise, not guessed at runtime). Unknown/custom exercises
  default by equipment: Machine/Cable → `hand`, Barbell/Dumbbell → `weight`.
- `hand`: track the wrist/grip from body pose (both hands averaged when both are
  visible); scale by the user's forearm/upper-arm length (body units) or real
  m/s via the user's height. Never switch to the weight stack for these.
- `weight`: track the plate/bar end (barbell) or dumbbell head; 45 cm plate as
  scale + ellipse for viewing angle. If the weight is lost for > 0.5 s, mark
  the rep's velocity "unclear" — do NOT silently fall back to the hand.
- *Leg extension / leg curl: the "hand" equivalent is the ankle pad point
  (the moving contact point); treat as `hand` mode using the ankle landmark.
- Rep counting and the rep-1 standard (start/finish) keep using body pose for
  every exercise, independent of where velocity is measured.

## Velocity = D / T (decided by the user)
- **D (distance) is set by rep 1.** When "Standard locked" fires, record D = the
  distance the measured point (hand or weight, per the rule above) travelled
  between the Start and Finish lines on rep 1. Rep 1 is the reference period
  for the whole set.
- **T (time) per rep** = time from leaving the Start line to reaching the Finish
  line during the lifting (concentric) phase. Interpolate the exact crossing
  moment between frames (sub-frame timing) using frame timestamps; request
  60 fps.
- **Mean concentric velocity of rep n = D / Tₙ.** Only counted reps get a
  velocity; short reps (didn't travel D) get none; unclear reps get none.
- **Velocity loss = T₁ / Tₙ** — D cancels, so it needs no scale, distance or
  angle correction. This is the primary signal for RIR and progress.
- **Absolute m/s is optional**: convert D to metres only when needed (research
  thresholds), using the hand/weight scaling above. Optionally use each rep's
  own measured distance when tracking confidence is high, else D.
- Accuracy target: timing error ≤ 2% (sub-frame interpolation at 60 fps).

## Coach-readable velocity charts + Coaching tab (decided by the user)
Goal: a tool powerlifting coaches would trust and use. Readability first,
conventions coaches already know, no decorative charting.

**Per set (athlete and coach both see this)**
- A rep-by-rep **bar chart**: one bar per counted rep, **mean concentric
  velocity in m/s labelled on every bar (2 decimals)**, rep number underneath.
  Short/unclear reps shown as empty outlined slots with their reason, so the
  rep order stays honest.
- A dashed horizontal **target / stop line** (e.g. 20% velocity loss from rep 1)
  and the rep where it was crossed highlighted.
- Header row of the numbers coaches ask for: load (kg), reps counted, rep-1
  velocity, best rep, last rep, **velocity loss %**, typed RIR, and
  velocity-estimated RIR once the athlete is calibrated.
- Fixed, honest axes (always start at 0 m/s; same scale for every set of a lift
  in a session) so sets can be compared at a glance. Colour only for meaning
  (counted vs short), never decoration; readable in light and dark; large
  type on phone.
- Units: m/s when D has a real-world scale; otherwise show "relative speed"
  (rep 1 = 100%) and say so — never fake m/s.

**Per lift over time (load–velocity profile)**
- Scatter of rep-1 velocity vs load (kg) per session, with a fitted line
  (least squares) — the standard **load–velocity profile**.
- **Estimated 1RM** from the profile at the lift's minimum velocity threshold
  (squat ≈ 0.30, bench ≈ 0.17 m/s from velocity.js MVT; deadlift to be
  sourced), labelled "estimate" with the number of sessions it's based on.
- Same-load trend: "80 kg moves 8% faster than 4 weeks ago" — this is what
  drives the "add weight / add a rep" suggestion.
- Optional velocity **zones** coaches use (e.g. absolute strength < 0.5 m/s,
  strength–speed 0.75–1.0 m/s) as a faint background band, toggleable.

**Coaching tab integration (reuse what exists in workouts.html)**
- Store per set: load, D, Tₙ per rep, MCV per rep, velocity loss, standard
  (start/finish), counted/short/unclear, typed RIR — inside the existing workout
  record, so it flows through the Coaching tab's export/import
  (buildClientExport / applyCoachUpdate / showClientProg) with no new backend.
- Coach view per client: latest session's sets with the bar charts, each lift's
  load–velocity profile and e1RM trend, and flags (velocity loss above target,
  rep-1 velocity well below usual = possible fatigue).
- Coach can set **velocity targets per lift** (target rep-1 velocity range and
  velocity-loss stop %) in the program they send; the athlete's logger shows
  "stop here" when the stop line is crossed.
- Exports for coaches: CSV of every rep (date, lift, load, rep, MCV, VL%, RIR)
  and a clean PNG of any chart for sharing in chat.

## Full VBT metric set — with honest accuracy tiers
From position x(t) of the measured point (hand or weight) + load m (typed) +
D (rep 1, metres when scaled): v = dx/dt, a = d²x/dt², F = m(g + a), P = F·v.
Each differentiation amplifies noise, so accuracy depends on frame rate.

| Metric | Definition / computation | Phone accuracy |
|---|---|---|
| Mean velocity (MV) | D / T over the concentric phase | High (only crossing times) |
| Intra-set fatigue | (fastest MV − slowest MV) / fastest MV within a set | High (ratio) |
| Between-set fatigue | fastest rep of the session vs slowest | High (ratio) |
| Range of motion | D (rep 1); per-rep distance when confident | High relative; cm needs scale |
| Average power | m·g·D / T (work–energy; bar starts & ends at rest) | High (needs load + D in m) |
| Mean propulsive velocity (MPV) | mean v from concentric start until a < −g | Medium @60 fps, good @120–240 fps |
| Peak velocity | max instantaneous v | Medium @60 fps, good @120–240 fps |
| Peak power | max F·v | Low @60 fps, fair @240 fps |
| Peak force | m(g + max a) | Low — always labelled "estimate" (needs force plate / IMU for real) |

Rules:
- **Slow-motion capture**: support recording/importing iPhone slow-mo
  (120/240 fps) and analysing the set right after it ends; live counting can
  stay at normal fps. Derivative metrics (MPV, peak v, peak power) are only
  shown as reliable at ≥120 fps.
- **Confidence badge per metric** from frame rate + tracking quality; hide or
  mark "estimate" anything below its tier. Never present an estimate as exact.
- **System mass setting** for power/force: bar load only (default for bench,
  deadlift) vs bar + body mass for squat — user/coach choice, always shown.
- Smoothing: Savitzky–Golay on position; derivatives from the fitted
  polynomial, not frame differences. Same filter for every metric so numbers
  are consistent.
- The validation harness reports error per metric vs Qwik VBT / Metric (and a
  linear transducer if available); publish an accuracy table in-app.

## Recommended approach (best accuracy per effort)
- **Primary: bar tracking, not body tracking, for velocity.** Detect and follow the
  plate/bar end (circle/plate detection + optical-flow tracking) from a side view.
  The 45 cm plate doubles as the scale (real m/s) and its ellipse shape gives the
  viewing angle → correct foreshortening with trig. Keep the pose skeleton only
  for rep standardisation (start/finish) and for curls/pull-ups where there's no
  plate.
- **Placement handling:** gravity vector (phone motion sensors) for tilt; plate
  ellipse for angle; refuse > ±25° off side-on; 60 fps with frame timestamps;
  smooth position, then differentiate.
- **Gold-standard mode: Apple Watch on the wrist.** Watch accelerometer gives
  velocity independent of camera placement; use it to cross-check the camera
  and as "pro" accuracy. Needs a small watchOS companion app.
- **ARKit/LiDAR: optional enhancement, not the foundation** — native-only,
  Pro-only for LiDAR, unvalidated for bar speed.
- **Progress logic always uses ratios** (velocity loss within a set, same-load
  velocity over ≥3 sessions), which stay valid even if absolute m/s drifts.

## Build order (when approved)
1. Validation harness: import a recorded set, compare our velocity vs Qwik VBT /
   Metric on the same video; report error per lift.
2. Plate/bar-end tracker + plate-based scale and angle correction (web, works on
   all phones) → velocity per rep stored per set.
3. Integrate recording into Start Workout (auto reps + standard + velocity).
4. "Getting easier" trend with a confidence threshold.
5. Optional: Apple Watch companion; ARKit/LiDAR native module.

## Verification
- Unit tests for tracker maths (scale, ellipse angle correction, smoothing).
- Side-by-side tests on real gym videos at 0°, ±15°, ±25° and different
  distances; target ≤5% error on mean concentric velocity vs a reference app.

## Sources
- Renner et al. 2024, PLOS ONE: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11575817/
- Metric VBT validation (Trowell 2024, PeerJ): https://peerj.com/articles/17789
- Metric summary of three-app study: https://metric.coach/articles/concurrent-validity-of-novel-smartphone-based-apps-monitoring-barbell-velocity-in-powerlifting-exercises
- AI bench app validity (Balsalobre-Fernández): https://www.researchgate.net/publication/370359604
- Apple Watch vs Enode (Achermann 2023): https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10383699/
- IMU systematic review (Clemente 2021): https://pubmed.ncbi.nlm.nih.gov/33916801/
- Vmaxpro validity (Olaya-Cuartero 2022): https://rua.ua.es/dspace/bitstream/10045/130113/1/Olaya-Cuartero_etal_2022_JPES.pdf
- Markerless pose for resistance training: https://arxiv.org/pdf/2608.24384
- ARKit vs Vicon (Reimer 2021): https://ebooks.iospress.nl/volumearticle/56676
