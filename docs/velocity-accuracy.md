# Camera bar speed vs a velocity transducer — test protocol and what to expect

Arete measures bar speed by following a weight plate in the phone's video and
working out where it is in 3D, every frame. This document is the protocol for
checking it against a cable velocity transducer (GymAware, Vitruve, Tendo),
the results it gets in simulation, and every known source of error with its
size. Nothing here has yet been confirmed on real gym video — that's what the
protocol is for.

## What "as good as a transducer" means

Two good devices disagree with each other too. Against 3D motion capture, a
GymAware has a standard error of 0.02–0.04 m/s on mean velocity and limits of
agreement of roughly ±0.03–0.06 m/s. So the targets for the camera, per lift,
on mean concentric velocity (MCV) against the cable:

| | Target |
|---|---|
| Average difference (bias) | within ±0.03 m/s |
| Root-mean-square difference | ≤ 0.04 m/s |
| 95% of reps within (limits of agreement) | ±0.06 m/s |
| Reps found | every rep the cable counts (unclear ones say why) |

The lab page (`velocity-lab.html`) checks all of these for you and keeps a
running table per lift and camera angle.

## Setup

**Phone**
- On a tripod or propped up firmly — it must not move during the set. Don't
  touch it between "start" and the last rep.
- 2–3 m from the bar, **20–40° off side-on** (looking at the plate's face, a
  little from the front or the back). This is where the camera is most
  accurate in simulation (mean error ~1.5–2%). Side-on (0–20°) is good too;
  past 45° the plate's thickness starts to blur its edge.
- Lens roughly at bar height or a little below, phone upright (not tilted
  sideways), the **whole near plate in view through the whole set** with a
  margin — at the top and the bottom of every rep. A plate that leaves the
  picture gives "unclear" reps, never a guess.
- 60 fps if the camera app offers it (30 fps works; fast reps are timed a
  little less precisely).
- Good light. Nothing between the phone and the plate (a spotter, a rack
  upright, the lifter's hand crossing it).

**Plate**
- The outermost plate should be a full-size plate (45 cm: any bumper plate, or
  a 20/25 kg iron plate). If the outer plate is smaller, enter its diameter in
  the lab page. With iron plates, a smaller plate in front of a 45 cm one is
  fine only if the 45 cm rim is clearly visible all round it.

**Cable**
- Clip it to the bar on the **same side the phone films**, as close to the
  plates as the device allows. Under heavy loads the bar flexes: its ends move
  slightly further than its middle (studies: 5–11% more displacement at the
  ends in heavy squats), so measure both at the same end.
- Set the device to report mean concentric velocity per rep. If it can also
  show peak velocity and range of motion (ROM), note those too.

## The sets

- Squat and bench, separately (they're judged separately).
- About **5 sets per lift across loads**: roughly 40, 60, 75, 85 and 90% of
  your 1RM, 3–5 reps each. That's 30+ reps per lift — enough for the limits of
  agreement to mean something. Include at least one set to a grind (near
  failure): slow reps with a sticking point are where errors hide.
- Film each set from start to finish (start recording before you unrack,
  stop after you rack).
- Vary the camera angle across sets if you want to test it (e.g. two sets at
  ~25°, two at ~40°, one side-on) and pick the angle in the lab page.

## Each set in the lab page

1. Open `velocity-lab.html` on a computer (Chrome or Safari).
2. Choose the lift, "The plate in 3D (any camera angle)", the plate diameter
   (45 cm), the reference ("GymAware", "Vitruve", "Tendo"), the camera angle
   and distance.
3. Choose the video. Arete outlines what it thinks is the plate — if the green
   outline isn't on the plate's outer edge, tap the middle of the plate, or
   move the slider to a clearer frame. Then "Track".
4. The pass plays the video slowly (so no frame is skipped) and shows the
   outline it follows. Check it hugs the plate's outer edge.
5. Arete lists every lift of the bar in order, with its mean, propulsive and
   peak velocity, and the pose counter's verdict on the rep. A lift without a
   number says why (the plate was lost, frames were missing where it started
   or ended); one with "estimate" was seen too sparsely or noisily to be
   transducer-grade.
6. Paste the device's per-rep numbers (one mean velocity per line; or "mean,
   peak, ROM" per line; or the device's CSV export) and Compare.
7. Read the verdict: the % error per rep, and whether bias, RMS and the 95%
   limits are within the transducer targets. Save to the accuracy table.
8. "Save tracks" keeps the expensive part (the tracked outlines and poses) so
   the set can be re-analysed later without the video.

When all sets are in: the accuracy table per lift and angle, plus "Export
CSV" — that file has every rep (ours, the device's, the difference) and can be
sent back for analysis.

## How it measures (short)

- **The plate's outline**, every frame, to a fraction of a pixel: on 72 rays
  from its centre, the edge nearest the predicted outline whose inside has the
  rim's colour; a robust ellipse through them. At lock-on, the face's rim is
  told apart from the rings inside it (hub, lip, lettering) and from the
  silhouette of the face with the plate's side band.
- **Its 3D position**: a circle of known size seen through a camera is fixed in
  3D by its ellipse (up to a mirror twin, settled over the whole set by which
  reading keeps facing the same way, sideways). The plate's distance from the
  camera — the noisy direction — is taken from the plane the plate moves in
  (square to the bar), so the frame-to-frame size noise doesn't leak into the
  height when the camera looks up or down at the bar.
- **Gravity**: from the phone's motion sensors on the live page; a recorded
  video has none, so "up" is taken from the plate (square to its facing,
  closest to the picture's up) — exact for the tilt the plate can see.
- **Each lift** is timed from leaving the bottom to stopping at the top, as a
  transducer times it: found where the speed passes 5% of the rep's peak, then
  extended over the slow first and last moments (the time the measured
  acceleration would take to reach that speed). A near-stall at a sticking
  point stays one lift.
- **MCV** = that lift's distance ÷ its time. Peak velocity from a parabola
  round the fastest frame; mean propulsive velocity until the bar decelerates
  faster than gravity.

## Simulator results

A ray-traced simulator films lifts with exact ground truth: random placements
(±60°, 1.4–3.8 m, lens 0.6 m below to 1.1 m above the bar, tilted and rolled),
random lens (60–76° field of view, the app assuming 68°; barrel distortion),
30 and 60 fps with jitter and dropped frames, motion blur, rolling shutter,
sensor noise, a lifter's body behind the plate, plates with thickness, a
sleeve, a hub, a lip and lettering, and physically shaped lifts (force builds
over 30–80 ms after a pause, touch-and-go carries the bounce's acceleration,
eases or locks out at the top; grinders with sticking points).

Latest sweep: 60 sets, 149 reps (`node scripts/velocity-accuracy.mjs --n 60`).
Reps with the whole plate in view (120): 118 measured, 2 refused as unclear.

| MCV, m/s | All measured reps (118) | Reps of sets with a clear rim (99) |
|---|---|---|
| Bias | −0.003 | −0.003 |
| Mean error | 0.013 | 0.010 |
| RMS | 0.020 | 0.014 |
| 95% of reps within | 0.047 | 0.028 |
| Worst | 0.089 | 0.056 |

The other 19 reps come from sets where less than 85% of the plate's rim lined
up with the tracked outline (its side band or a ring blurring into the edge at
a steep angle): those are marked as estimates (RMS 0.038 m/s).

By camera angle (all measured reps, mean error on MCV): 0–20° off side-on
1.8%, 20–40° 1.9% (95% within 4.4%), 40–60° 3.8%. By lift: squat 1.9%,
deadlift 2.5%, bench 2.9%. Peak velocity: RMS 0.037 m/s; mean propulsive
velocity: 0.029 m/s; range of motion: mean error 1.9%.

(Reps where the plate partly left the picture are refused when the lift's
start or end wasn't seen; otherwise they're measured from what was.)

## Known sources of error, and their size

| Source | Effect on MCV | Handled by |
|---|---|---|
| Plate edge located to ~0.1–0.3 px | ±1–2% per rep at 30 fps, less at 60 | Robust ellipse fit; plane-based depth; smoothing (±83 ms) |
| Slow first/last moments of a lift (timing definition) | 0–2% depending on how the lift starts | Ends extended by speed ÷ acceleration (rule calibrated on physically shaped lifts) |
| A near-stop just short of lockout, then a creep of the last few mm | up to +10–20% (the creep isn't timed) | Over half a centimetre left: the rep is an estimate; under it, devices disagree too |
| A settle or a bad frame after lockout | none (the lift ends at the stop) | Lifts end where the bar stops, not where it later twitches; bad frames are dropped |
| Plate's side band (thickness) at steep angles | up to −2…−4% distance at 45–60° | Face rim told apart from the band at lock-on; film at 20–40° |
| Phone's field of view unknown | small side-on; grows with tilt | Assumed, then corrected from the plate where it can be seen |
| Gravity (no sensors in a video) | tilt about the bar's own axis assumed level | Up from the plate; live page uses the phone's sensors |
| Bar flex / bar-end vs bar-middle | ends move 5–11% more in heavy squats | Clip the cable at the same end the camera films |
| Frames skipped by a busy phone | fast reps read 3–7% slow under ~24 fps | Such reps are marked "estimate" |
| Plate out of view, or blocked, at the start or end of a lift | the lift can't be timed | Rep marked "unclear" — never filled in |
| The phone moving during the set | everything shifts | Live page: motion sensors flag it |
| Real video differs from the simulator | unknown until tested | This protocol |

## Honest limits

- **Unproven on real video.** Everything above is simulation plus a check in
  Chrome with a simulated camera. Real lighting, compression, motion blur at
  1/30 s exposures in a dim gym, and real plates (black sides on black faces)
  can be harder than the simulator.
- **Steep angles.** Past ~45° the plate's side band is wide and can be hard to
  separate from the face's own edge, especially on black bumper plates.
- **Timing definition.** Devices don't all start and stop a rep at the same
  moment; a consistent 1–3% difference against one device can be a
  definition difference rather than an error. The lab's bias column shows it;
  if a consistent bias shows up across 30+ reps, it can be corrected.
- **One plate, one end.** The camera measures the end of the bar it sees.
