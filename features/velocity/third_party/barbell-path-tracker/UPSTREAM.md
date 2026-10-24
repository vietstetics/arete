# Marticles / barbell-path-tracker

Source: https://github.com/Marticles/barbell-path-tracker
Pinned revision: `501daea5c0666b3564fadbbebb51e6f6ac0b2428`
Retrieved: 24 October 2026.
Copyright (c) 2018 Marticles. Licence: MIT; complete notice in `LICENSE`.

`tracker.py` and `README.upstream.md` are unmodified source snapshots. The
complete Git checkout is available locally at `vendor/barbell-path-tracker/`
and is intentionally excluded from Arete's Git index and web build. Example
videos/result images are not redistributed in the application.

Arete's browser implementation in `services/vision/template.js` adapts the
upstream `Template_Matching` mode: manually select a rectangle, retain its
grayscale template, match with normalized zero-mean correlation (the
`TM_CCOEFF_NORMED` criterion), follow the bounding-box centre and draw its path.
The desktop program's default Dlib tracker and other OpenCV trackers are not
ported or claimed to run in the browser.

The adaptation adds bounded search, ambiguity/contrast rejection, frame-time
handling, tracking-loss states, mobile pointer selection, and integration with
Arete's existing pose-based rep standard and velocity records. A fixed template
does not infer physical scale, camera motion, rotation or changing depth. It
reports relative movement; it never interprets image coordinates as metres.

The original program reports processing FPS and pixel positions; it has no
physical velocity, rep detection, first-rep ROM calibration or strength model.
Those remain Arete's separate layers. No claim of Dlib or OpenCV validation is
made for the JavaScript adaptation.
