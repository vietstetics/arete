"""Boundary tests plus genuine upstream integration when its optional dependencies exist."""
import copy
import importlib.util
import json
import math
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("barbellcv_adapter", ROOT / "scripts" / "barbellcv-analyze.py")
adapter = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(adapter)
UPSTREAM = ROOT / "vendor" / "barbellcv"
DEPS = all(importlib.util.find_spec(name) for name in ("numpy", "pandas", "scipy", "cv2"))


def fixture():
    frames = []
    for i in range(181):
        t = i / 30
        # A smooth 150-pixel rise, pause, then lower. No tracking/device accuracy is implied.
        if t < 1:
            rise = 0
        elif t < 2:
            rise = 75 * (1 - math.cos(math.pi * (t - 1)))
        elif t < 3:
            rise = 150
        elif t < 4:
            rise = 75 * (1 + math.cos(math.pi * (t - 3)))
        else:
            rise = 0
        frames.append({"t": 12 + t, "ok": True, "cx": 300 + 2 * math.sin(t), "cy": 600 - rise})
    return {"format": adapter.INPUT_FORMAT, "recordId": "genuine-upstream-fixture",
            "source": {"tracker": "marticles-template-v1"}, "frame": {"width": 1280, "height": 720},
            "initialBox": {"x": 280, "y": 580, "w": 40, "h": 40}, "frames": frames,
            "poseReps": [{"n": 1, "result": "counted", "isStandard": True, "topT": 13}],
            "standard": {"start": 100, "finish": 50}, "metadata": {"exercise": "Synthetic test", "loadKg": 80}}


class BoundaryTests(unittest.TestCase):
    def test_valid_track_and_calibration(self):
        track = fixture()
        self.assertIs(adapter.validate_track(track), track)
        self.assertFalse(adapter.calibration_options()["physical"])
        self.assertEqual(adapter.calibration_options(50, 20)["diameterM"], 0.05)

    def test_missing_and_invalid_samples_are_not_filled(self):
        for key, value in (("ok", False), ("ok", 1), ("t", math.nan), ("t", True), ("cx", math.inf), ("cy", -1)):
            with self.subTest(key=key, value=value):
                track = fixture(); track["frames"][10][key] = value
                with self.assertRaises(adapter.AdapterError): adapter.validate_track(track)
        for key in ("t", "cx", "cy"):
            track = fixture(); del track["frames"][10][key]
            with self.assertRaises(adapter.AdapterError): adapter.validate_track(track)

    def test_clock_gaps_duplicates_and_backwards_time_are_rejected(self):
        for t in (12, 12.1, 50):
            track = fixture(); track["frames"][10]["t"] = t
            with self.assertRaises(adapter.AdapterError): adapter.validate_track(track)
        for gap in (0, -1, math.inf, 2):
            with self.assertRaises(adapter.AdapterError): adapter.validate_track(fixture(), gap)

    def test_at_least_21_samples_and_source_geometry_required(self):
        track = fixture(); track["frames"] = track["frames"][:20]
        with self.assertRaises(adapter.AdapterError): adapter.validate_track(track)
        for edit in (
            lambda r: r.update(format="wrong"), lambda r: r.update(recordId=""),
            lambda r: r["source"].update(tracker="pose"), lambda r: r["frame"].update(width=0),
            lambda r: r["frame"].update(height=True), lambda r: r["initialBox"].update(w=7),
            lambda r: r["initialBox"].update(x=1280),
        ):
            track = fixture(); edit(track)
            with self.assertRaises(adapter.AdapterError): adapter.validate_track(track)

    def test_no_implicit_box_calibration_or_half_calibration(self):
        for args in ((50, None), (None, 10), (math.nan, 10), (50, math.inf), (-50, 10), (50, True)):
            with self.assertRaises(adapter.AdapterError): adapter.calibration_options(*args)
        self.assertEqual(adapter.calibration_options(), {"physical": False, "diameterM": None, "markerRadiusPx": None})

    def test_missing_upstream_is_an_explicit_error(self):
        with self.assertRaisesRegex(adapter.AdapterError, "clone is missing"):
            adapter.load_upstream(ROOT / "backups" / "barbellcv-does-not-exist")

    def test_nonstandard_json_values_and_size_limit(self):
        folder = ROOT / "backups"; folder.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=folder) as directory:
            path = Path(directory) / "invalid.json"; path.write_text('{"bad":NaN}', encoding="utf-8")
            with self.assertRaises(adapter.AdapterError): adapter.read_track(path)
            path.write_text('{"bad":Infinity}', encoding="utf-8")
            with self.assertRaises(adapter.AdapterError): adapter.read_track(path)


@unittest.skipUnless(DEPS and (UPSTREAM / "utils" / "analyze.py").is_file(), "Genuine upstream clone/numpy/pandas/scipy/cv2 not available in this Python; no integration success is claimed")
class GenuineUpstreamTests(unittest.TestCase):
    def test_real_upstream_functions_and_portable_units(self):
        track = fixture(); before = copy.deepcopy(track)
        result = adapter.analyze_track(track, UPSTREAM)
        self.assertEqual(result["format"], "arete-barbellcv-analysis-v1")
        self.assertEqual(result["upstreamRevision"], adapter.UPSTREAM_REVISION)
        self.assertEqual(result["units"], "relative")
        self.assertEqual(result["nativeUnits"], "source pixels")
        self.assertIsNone(result["calibration"]["markerRadiusPx"])
        self.assertFalse(result["calibration"]["validated"])
        self.assertGreaterEqual(len(result["measurements"]), 1)
        self.assertEqual(track, before)
        for n, row in enumerate(result["measurements"], 1):
            self.assertEqual(row["n"], n); self.assertGreater(row["T"], 0)
            self.assertAlmostEqual(row["T"], row["tEnd"] - row["tStart"])
            self.assertGreaterEqual(row["tStart"], 12)
            self.assertGreaterEqual(row["pv"], row["mcv"])
            self.assertGreaterEqual(row["pathDistance"] + 1e-8, max(row["xRom"], row["yRom"]))
        self.assertNotIn("peakPower", result)
        json.dumps(result, allow_nan=False)

    def test_explicit_physical_geometry_is_still_an_unvalidated_estimate(self):
        result = adapter.analyze_track(fixture(), UPSTREAM, diameter_mm=50, marker_radius_px=20)
        self.assertEqual(result["units"], "m/s")
        self.assertEqual(result["calibration"]["diameterM"], 0.05)
        self.assertEqual(result["calibration"]["markerRadiusPx"], 20)
        self.assertFalse(result["calibration"]["validated"])
        self.assertTrue(result["calibration"]["estimate"])

    def test_upstream_outlier_replacements_are_refused(self):
        track = fixture(); track["frames"][50]["cx"] = 1000
        with self.assertRaisesRegex(adapter.AdapterError, "outlier replacement"):
            adapter.analyze_track(track, UPSTREAM)

    def test_cli_calls_genuine_upstream_and_matches_browser_parser(self):
        folder = ROOT / "backups"; folder.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=folder) as directory:
            source, output = Path(directory) / "track.json", Path(directory) / "analysis.json"
            source.write_text(json.dumps(fixture()), encoding="utf-8")
            command = [sys.executable, str(ROOT / "scripts" / "barbellcv-analyze.py"), str(source), "--output", str(output)]
            completed = subprocess.run(command, capture_output=True, text=True, cwd=ROOT)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            result = json.loads(output.read_text(encoding="utf-8"))
            self.assertGreaterEqual(len(result["measurements"]), 1)
            if shutil.which("node"):
                js = "import fs from 'node:fs'; import {parseBarbellCvAnalysis} from './features/velocity/services/externalAnalysis.js'; const raw=fs.readFileSync(process.argv[1],'utf8'); const result=parseBarbellCvAnalysis(raw,{recordId:'genuine-upstream-fixture'}); console.log(result.measurements.length);"
                parsed = subprocess.run(["node", "--input-type=module", "-e", js, str(output)], capture_output=True, text=True, cwd=ROOT)
                self.assertEqual(parsed.returncode, 0, parsed.stderr)
                self.assertGreaterEqual(int(parsed.stdout), 1)
            forbidden = subprocess.run(command[:-2] + ["--output", str(source)], capture_output=True, text=True, cwd=ROOT)
            self.assertEqual(forbidden.returncode, 2)
            self.assertEqual(json.loads(source.read_text(encoding="utf-8"))["format"], adapter.INPUT_FORMAT)


if __name__ == "__main__":
    unittest.main(verbosity=2)
