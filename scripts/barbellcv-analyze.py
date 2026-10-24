#!/usr/bin/env python3
"""Local adapter to the separately cloned BarbellCV analytics; no upstream code is bundled."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import subprocess
import sys
import warnings as python_warnings

UPSTREAM_REVISION = "7ffcd8853a3dbfb8da2b1993f63d844d3279cd2a"
UPSTREAM_ANALYZE_SHA256 = "8b84f7ca2354a378ea9f4d111b9a7eba434a003d118f2a47ee52df9f63bc8463"
INPUT_FORMAT = "arete-target-track-v1"
OUTPUT_FORMAT = "arete-barbellcv-analysis-v1"
CONVENTION = "barbellcv-2d-path-speed-v1"
MAX_INPUT_BYTES = 20 * 1024 * 1024


class AdapterError(ValueError):
    """A rejected boundary or unavailable local analysis, suitable for a CLI error."""


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def positive(value):
    return number(value) and value > 0


def reject_constant(value):
    raise AdapterError(f"Nonstandard JSON number is not accepted: {value}")


def read_track(path):
    path = Path(path)
    if path.stat().st_size > MAX_INPUT_BYTES:
        raise AdapterError("Target track exceeds the 20 MB input limit.")
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"), parse_constant=reject_constant)
    except json.JSONDecodeError as exc:
        raise AdapterError(f"Invalid target-track JSON: {exc.msg}") from exc


def validate_track(track, max_gap_sec=0.25):
    if not isinstance(track, dict) or track.get("format") != INPUT_FORMAT:
        raise AdapterError(f"Expected {INPUT_FORMAT}.")
    record_id = track.get("recordId")
    if not isinstance(record_id, str) or not record_id.strip() or len(record_id) > 256:
        raise AdapterError("A nonempty recordId of at most 256 characters is required.")
    if not isinstance(track.get("source"), dict) or track["source"].get("tracker") != "marticles-template-v1":
        raise AdapterError("Only the explicitly selected Marticles template track is supported.")
    frame = track.get("frame")
    if not isinstance(frame, dict) or any(not isinstance(frame.get(k), int) or isinstance(frame.get(k), bool)
                                         or not 8 <= frame[k] <= 32768 for k in ("width", "height")):
        raise AdapterError("Finite integer source frame dimensions are required.")
    box = track.get("initialBox")
    if not isinstance(box, dict) or any(not number(box.get(k)) for k in ("x", "y", "w", "h")):
        raise AdapterError("The original selected rectangle is required in source-frame pixels.")
    if box["x"] < 0 or box["y"] < 0 or box["w"] < 8 or box["h"] < 8 or box["x"] + box["w"] > frame["width"] or box["y"] + box["h"] > frame["height"]:
        raise AdapterError("The selected rectangle must be in bounds and at least 8 pixels per side.")
    if not positive(max_gap_sec) or max_gap_sec > 1:
        raise AdapterError("Maximum allowed sampling gap must be positive and at most one second.")
    frames = track.get("frames")
    if not isinstance(frames, list) or not 21 <= len(frames) <= 60000:
        raise AdapterError("At least 21 measured samples are needed for the upstream calibration window (maximum 60000).")
    previous = None
    for i, row in enumerate(frames):
        if not isinstance(row, dict) or row.get("ok") is not True:
            raise AdapterError(f"Frame {i}: missing or rejected tracking cannot be interpolated or filled.")
        if any(not number(row.get(k)) for k in ("t", "cx", "cy")) or row["t"] < 0:
            raise AdapterError(f"Frame {i}: finite, nonnegative timestamps and finite measured centers are required.")
        if not (0 <= row["cx"] <= frame["width"] and 0 <= row["cy"] <= frame["height"]):
            raise AdapterError(f"Frame {i}: target center lies outside the source frame.")
        if previous is not None and (row["t"] <= previous or row["t"] - previous > max_gap_sec + 1e-9):
            raise AdapterError(f"Frame {i}: timestamps must strictly increase without a gap over {max_gap_sec:g} s.")
        previous = row["t"]
    return track


def calibration_options(diameter_mm=None, marker_radius_px=None):
    if diameter_mm is None and marker_radius_px is None:
        return {"physical": False, "diameterM": None, "markerRadiusPx": None}
    if not positive(diameter_mm) or not positive(marker_radius_px):
        raise AdapterError("Physical calibration requires both a measured --diameter-mm and --marker-radius-px, each finite and positive.")
    return {"physical": True, "diameterM": diameter_mm / 1000, "markerRadiusPx": marker_radius_px}


def load_upstream(upstream_dir):
    upstream_dir = Path(upstream_dir).resolve()
    source = upstream_dir / "utils" / "analyze.py"
    if not source.is_file():
        raise AdapterError("The separate BarbellCV clone is missing. See docs/barbellcv-local.md.")
    if hashlib.sha256(source.read_bytes().replace(b"\r\n", b"\n")).hexdigest() != UPSTREAM_ANALYZE_SHA256:
        raise AdapterError("utils/analyze.py differs from the supported pinned BarbellCV source; refusing an unreviewed analysis version.")
    try:
        revision = subprocess.run(["git", "-C", str(upstream_dir), "rev-parse", "HEAD"], check=True, capture_output=True, text=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError) as exc:
        raise AdapterError("Cannot verify the separate upstream Git revision; Git and the pinned clone are required.") from exc
    if revision != UPSTREAM_REVISION:
        raise AdapterError(f"Expected upstream revision {UPSTREAM_REVISION}, received {revision}.")
    try:
        spec = importlib.util.spec_from_file_location("arete_separate_barbellcv_analysis", source)
        module = importlib.util.module_from_spec(spec)
        with python_warnings.catch_warnings():
            python_warnings.simplefilter("ignore", DeprecationWarning)
            spec.loader.exec_module(module)
    except ModuleNotFoundError as exc:
        raise AdapterError(f"Missing local dependency '{exc.name}'. Activate the isolated environment and install numpy pandas scipy opencv-python-headless; see docs/barbellcv-local.md.") from exc
    return module


def analyze_track(track, upstream_dir, *, diameter_mm=None, marker_radius_px=None, max_gap_sec=0.25):
    validate_track(track, max_gap_sec)
    calibration = calibration_options(diameter_mm, marker_radius_px)
    upstream = load_upstream(upstream_dir)
    # Use the upstream module's actual imported numerical dependency, not a stub or port.
    np = upstream.np
    raw = track["frames"]
    origin = raw[0]["t"]
    t = np.array([p["t"] - origin for p in raw], dtype=np.float64)
    x = np.array([p["cx"] for p in raw], dtype=np.float64)
    # The upstream GUI makes this same downward-pixel to upward-motion conversion.
    y = np.array([track["frame"]["height"] - p["cy"] for p in raw], dtype=np.float64)
    for arr in (x, y):
        arr[np.abs(arr) < 1e-7] = 0
    # A selected template's box width/height is not a measured marker radius.
    radius = calibration["markerRadiusPx"] if calibration["physical"] else 1.0
    diameter = diameter_mm if calibration["physical"] else 2000.0
    radii = np.full(len(raw), radius, dtype=np.float64)
    # Preflight the genuine upstream outlier routine, then refuse any replacement.
    # Nothing is interpolated, patched or silently smoothed over a tracking jump.
    for name, arr in (("X", x), ("Y", y)):
        try:
            with np.errstate(divide="ignore", invalid="ignore"):
                smoothed = upstream.reject_outliers(arr.copy(), 3, 0.3)
        except (IndexError, FloatingPointError, ValueError) as exc:
            raise AdapterError(f"{name} path cannot be safely analyzed by the upstream outlier routine; no replacement is permitted.") from exc
        if not np.array_equal(arr, smoothed, equal_nan=False):
            raise AdapterError(f"{name} path would trigger upstream outlier replacement; rejected rather than inventing positions.")
    metadata = track.get("metadata") if isinstance(track.get("metadata"), dict) else {}
    weight = metadata.get("loadKg")
    if not number(weight) or weight < 0:
        weight = 0  # Required upstream only for power; no power output is imported or published.
    exercise = metadata.get("exercise") if isinstance(metadata.get("exercise"), str) else "Unspecified"
    try:
        with np.errstate(divide="ignore", invalid="ignore"):
            data, factor = upstream.analyze_set(t.copy(), x.copy(), y.copy(), radii, diameter)
            _, rep_stats = upstream.analyze_reps(data, {"set_id": track["recordId"], "lift": exercise, "weight": weight}, {})
    except (ValueError, IndexError, FloatingPointError, KeyError) as exc:
        raise AdapterError(f"The genuine upstream analysis could not analyze this track: {exc}") from exc
    if not positive(float(factor)) or not np.isfinite(data[["Time", "X_m", "Y_m", "Velocity", "Displacement"]].values).all():
        raise AdapterError("Upstream returned invalid numerical measurements; no result was exported.")
    labels, count = upstream.label(data["Reps"].values)
    rows = []
    for n in range(1, count + 1):
        indices = np.flatnonzero(labels == n)
        if len(indices) < 2:
            raise AdapterError("Upstream produced a zero-duration movement segment; no result was exported.")
        first, last = int(indices[0]), int(indices[-1])
        stats = rep_stats[f"rep{n}"]
        xs = data["X_m"].values[indices]
        ys = data["Y_m"].values[indices]
        row = {"n": n, "tStart": float(data["Time"].iloc[first]) + origin, "tEnd": float(data["Time"].iloc[last]) + origin,
               "mcv": float(stats["average_velocity"]), "pv": float(stats["peak_velocity"]),
               "T": float(stats["t_concentric"]),
               "distance": float(math.hypot(xs[-1] - xs[0], ys[-1] - ys[0])),
               "pathDistance": float(np.hypot(np.diff(xs), np.diff(ys)).sum()),
               "xRom": float(stats["x_rom"]), "yRom": float(stats["y_rom"])}
        if any(not number(v) or v < 0 for v in row.values()) or not positive(row["T"]):
            raise AdapterError("Upstream produced a nonfinite or invalid segment metric; no result was exported.")
        rows.append(row)
    notes = [
        "Separate local execution of the genuine pinned BarbellCV analyze_set and analyze_reps functions; not an Arete velocity replacement.",
        "Mean is the upstream sample-average 2D path speed, including horizontal motion. It is not vertical mean concentric velocity or mean propulsive velocity.",
        "Distance is endpoint displacement; pathDistance sums adjacent positions inside the segment. Upstream mean includes the entering sample step and is not forced to equal pathDistance/T.",
        "Upstream segmentation uses a fixed per-frame gradient threshold (0.01) and 5/9-frame morphology; sampling rate and selected scale change its movement segments.",
        "A fixed marker image radius is assumed throughout. Perspective, scale changes and camera motion are not corrected or externally validated.",
        "The selected bounding rectangle is not evidence of an actual circular marker radius. Only an independently measured marker radius/diameter may define physical scale.",
        "Tracking losses, long time gaps and paths requiring upstream outlier replacement are rejected; no missing samples are filled.",
        "Upstream peak_power is deliberately omitted: weight*gravity*peak 2D speed is not a validated peak mechanical-power measurement.",
        "Segments are external motion intervals, not Arete counted/ROM-approved reps. Original pose counts, standard and personal predictions remain separate.",
    ]
    if not calibration["physical"]:
        notes.append("No physical calibration supplied. Internal arbitrary scale is one source pixel per native path unit; all speed/distance outputs remain relative.")
    return {"format": OUTPUT_FORMAT, "recordId": track["recordId"], "upstreamRevision": UPSTREAM_REVISION,
            "generatedAt": datetime.now(timezone.utc).isoformat(), "convention": CONVENTION,
            "units": "m/s" if calibration["physical"] else "relative",
            "nativeUnits": "metres (assumed marker geometry)" if calibration["physical"] else "source pixels",
            "calibration": {"diameterM": calibration["diameterM"], "markerRadiusPx": calibration["markerRadiusPx"],
                            "method": "fixed marker diameter/image radius" if calibration["physical"] else "arbitrary source-pixel path scale",
                            "validated": False, "estimate": True},
            "measurements": rows, "warnings": notes}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Arete selected-target JSON export")
    parser.add_argument("--output", "-o", type=Path, help="Portable external-analysis JSON; otherwise print to stdout")
    parser.add_argument("--upstream", type=Path, default=Path(__file__).resolve().parents[1] / "vendor" / "barbellcv")
    parser.add_argument("--diameter-mm", type=float, help="Independently measured circular marker diameter in mm")
    parser.add_argument("--marker-radius-px", type=float, help="Measured marker radius in the exported frame coordinate system, held constant")
    parser.add_argument("--max-gap-sec", type=float, default=0.25, help="Reject larger sampling intervals; default 0.25 s (no interpolation)")
    args = parser.parse_args(argv)
    try:
        result = analyze_track(read_track(args.input), args.upstream, diameter_mm=args.diameter_mm,
                               marker_radius_px=args.marker_radius_px, max_gap_sec=args.max_gap_sec)
        encoded = json.dumps(result, allow_nan=False, indent=2, ensure_ascii=False)
        if args.output:
            if args.output.resolve() == args.input.resolve():
                raise AdapterError("Output must be a separate file; the original observations cannot be overwritten.")
            args.output.write_text(encoded + "\n", encoding="utf-8")
            print(f"Wrote {len(result['measurements'])} separate BarbellCV motion segments to {args.output}", file=sys.stderr)
        else:
            print(encoded)
        return 0
    except (AdapterError, OSError) as exc:
        print(f"BarbellCV local analysis unavailable: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
