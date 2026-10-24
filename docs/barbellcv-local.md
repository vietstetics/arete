# Separate local BarbellCV analysis

Arete can export the measured path of a manually selected target and import a
separate BarbellCV analysis. This does not replace Arete's rep counts, ROM
standard, vertical velocity convention, workout velocity history or personal
prediction models. No BarbellCV Python source is included in the web bundle.

## Source and environment

The adapter loads the real `utils/analyze.py` from a separate local clone of
[tlancon/barbellcv](https://github.com/tlancon/barbellcv/tree/7ffcd8853a3dbfb8da2b1993f63d844d3279cd2a),
at revision `7ffcd8853a3dbfb8da2b1993f63d844d3279cd2a`. It verifies both the Git
revision and a line-ending-normalized SHA-256 of that file. It calls upstream
`analyze_set` and `analyze_reps`; it is not a JavaScript rewrite or simulated
substitute. The upstream `setup.py` declares GPLv3, although this pinned checkout
does not contain a full LICENSE file. Keep the clone and its provenance separate;
do not treat it as MIT-licensed or copy it into the PWA.

From the Arete repository in PowerShell:

```powershell
git clone https://github.com/tlancon/barbellcv.git vendor/barbellcv
git -C vendor/barbellcv checkout 7ffcd8853a3dbfb8da2b1993f63d844d3279cd2a
python -m venv backups/barbellcv-venv
& backups/barbellcv-venv/Scripts/python.exe -m pip install numpy pandas scipy opencv-python-headless
```

The clone and `backups/` are ignored local resources. The wrapper does not need
the upstream GUI, Qt, webcam access, database or paid services. Python, Git and
the four numerical dependencies are required. A dependency import failure gives
an actionable error; it never returns fabricated analysis. The verification
environment used Python 3.14.6 with NumPy 2.5.4, pandas 3.1.0, SciPy 1.18.1 and
opencv-python-headless 5.0.0.93 in this isolated environment.

## Run an exported target path

Select and track the actual bar/weight target in Arete, complete the set, then
export its selected-target path JSON. Analyze that local file:

```powershell
& backups/barbellcv-venv/Scripts/python.exe scripts/barbellcv-analyze.py backups/target-track.json --output backups/barbellcv-result.json
```

Without physical calibration the output explicitly uses `units: "relative"`
and `nativeUnits: "source pixels"`. For the upstream calculation an arbitrary
scale of one source pixel per native path unit is used; it is never reported as
metres or m/s. The source-pixel convention can produce a different segmentation
from a physically scaled run because upstream's gradient threshold is fixed.

If a circular marker's actual diameter and its image radius have independently
been measured, both can be supplied:

```powershell
& backups/barbellcv-venv/Scripts/python.exe scripts/barbellcv-analyze.py backups/target-track.json --output backups/barbellcv-result.json --diameter-mm 50 --marker-radius-px 20
```

Those example numbers are command syntax, not a calibration recommendation.
The radius must use the **exported frame coordinate system**, including any
downscaling. A 40-pixel selected rectangle does not establish a 20-pixel circular
marker radius: the rectangle may contain background, a hub, an angled plate or
an object of another shape. The fixed image-radius assumption also fails if
distance, viewing angle, zoom or target scale changes. Physical outputs are
therefore always `validated: false`, `estimate: true` even with supplied scale.
The adapter does not infer marker size from the initial box.

Import `barbellcv-result.json` using Arete's separate external-analysis control
on the same captured record. The parser checks its exact record ID, upstream
revision, numerical fields and interval ordering. Importing it cannot certify
its accuracy or alter the original tracked observations or counts.

## Input and output

Input format is `arete-target-track-v1`, with a stable `recordId`,
`source.tracker: "marticles-template-v1"`, source `frame.width/height`,
`initialBox: {x,y,w,h}` and measured `frames: [{t,ok,cx,cy}]`. Optional
`poseReps`, `standard` and `metadata: {exercise,loadKg}` remain distinct from
BarbellCV's motion intervals.

Output format is `arete-barbellcv-analysis-v1`, with `recordId`,
`upstreamRevision`, `convention: "barbellcv-2d-path-speed-v1"`, `generatedAt`,
`units`, `nativeUnits`, explicit `calibration`, `warnings` and `measurements`.
Each external movement interval contains:

| Field | Meaning |
|---|---|
| `n` | Sequential external segment number, not an Arete counted rep |
| `tStart`, `tEnd`, `T` | Upstream sample boundaries and duration in seconds |
| `mcv` | Upstream arithmetic sample mean of 2D path speed |
| `pv` | Upstream maximum sample 2D path speed |
| `distance` | Euclidean displacement between segment endpoints |
| `pathDistance` | Sum of adjacent 2D positions inside the segment |
| `xRom`, `yRom` | Upstream coordinate ranges inside the segment |

Positions are converted from browser downward-positive Y to upward-positive Y,
as the upstream GUI does. Time is internally shifted to start at zero because
upstream sets `t[0] = 0`; output segment times are restored to the original
exported timeline. Real frame timestamps remain the basis for speed.

`mcv × T` need not equal `pathDistance`: the upstream mean is sample-weighted,
and its first selected speed includes the step entering the segment. These
values are not silently rewritten to agree. There is no MPV, force, power,
Arete ROM verdict or velocity-based effort prediction in this import.

## Rejection rules and limits

The adapter requires at least 21 measured samples because upstream calibration
uses samples 5–19. It refuses any `ok: false`, missing/nonfinite position,
duplicate/backward timestamp, off-frame center or invalid source rectangle.
Sampling intervals over 0.25 seconds are rejected by default; an explicit
`--max-gap-sec` may change that engineering boundary up to one second. This
does not fill or interpolate missing frames. The input JSON has a 20 MB limit.

Upstream normally replaces some position outliers using neighboring samples.
The adapter preflights the genuine upstream routine and refuses any track that
would be modified, including errors at an array edge. It does not silently fill
a tracking loss or jump. Smooth jitter that does not cross that routine's gate
is still possible and is not evidence of a valid track.

The genuine upstream implementation segments upward movement using a fixed
per-frame gradient threshold of 0.01 with 5/9-frame morphology. Its detected
intervals therefore depend on frame rate and scale and can omit or merge motion.
Its velocity includes horizontal movement, while Arete's own vertical MCV uses
a different quantity and different boundaries. Upstream's `weight × g × peak
speed` field is omitted because it does not establish actual peak mechanical
power. Camera motion, perspective and changing marker size are uncorrected.

Results are unvalidated estimates. Mathematical and import tests do not establish
agreement with a reference device, complete anatomical ROM or correct rep counts.

## Checks

```powershell
& backups/barbellcv-venv/Scripts/python.exe scripts/test_barbellcv_adapter.py
```

Boundary tests use standard-library `unittest`. Integration tests execute the
actual pinned upstream functions and CLI, with deterministic synthetic path
data, then pass the resulting JSON through Arete's browser import parser. They
explicitly skip when the optional dependencies/clone are absent; a skipped
integration is not reported as a successful upstream run. Synthetic fixtures
verify execution, numerical conventions, units and boundaries, not real-world
measurement accuracy.

The separate cloned Marticles sample video is not a known velocity reference.
Any local path-tracking smoke test on it must report tracking availability and
limitations separately from mathematical synthetic checks. It is not copied
into the application or distributed as a validation dataset.

The optional local diagnostic is:

```powershell
node scripts/test-template-video.mjs
```

It uses an isolated headless browser, a fixed manually inspected plate ROI and
actual decoded timestamps. This machine's Chromium could not decode the sample
MP4's codec, so local OpenCV decoded it into ignored `backups/` frames. The
browser template tracker then processed those real frames. One untuned trial
accepted 39 of 225 sampled matches (17.3%) across 9.34 seconds, lost the target
at 1.64 seconds and expired; no reliable lift interval was produced. This is a
recorded limitation, not successful full-set tracking or velocity validation.
The JSON report separates active tracking runtime from fast expired-state calls
and excludes decoder/network time; it is not a phone performance benchmark.
