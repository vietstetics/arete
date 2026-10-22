// Random but realistic filmed sets for the accuracy sweep
// (scripts/velocity-accuracy.mjs): lift, reps, phone placement and camera.

function rngOf(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];
const between = (r, a, b) => a + (b - a) * r();

/** A random but realistic set: lift, reps, phone placement and camera. */
export function scenario(i, seed = 1, res = [640, 360]) {
  const r = rngOf(seed * 100003 + i * 7919 + 17);
  const lift = pick(r, ['squat', 'squat', 'bench', 'bench', 'deadlift']);
  const nReps = 2 + Math.floor(r() * 2);
  const reps = [];
  for (let k = 0; k < nReps; k++) {
    const D = lift === 'bench' ? between(r, 0.32, 0.46) : lift === 'squat' ? between(r, 0.42, 0.65) : k ? reps[0].D : between(r, 0.48, 0.62); // deadlift: floor to lockout every rep
    const fast = lift === 'bench' ? between(r, 0.35, 0.7) : between(r, 0.5, 0.9);
    const T = k === nReps - 1 && r() < 0.5 ? between(r, 1.2, 2.4) : fast + k * between(r, 0, 0.25); // sometimes a grinder at the end
    reps.push({ T, D, dip: T > 1.1 ? between(r, 0.2, 0.55) : between(r, 0, 0.2) });
  }
  // How each lift starts from rest and stops at the top (physical ends, scene3d.concentricProfile): drawn from
  // their own stream so every other detail of set i is unchanged from earlier sweeps.
  const r2 = rngOf(seed * 7919 + i * 104729 + 3);
  for (const x of reps) { x.onMs = between(r2, 30, 80); x.offMs = r2() < 0.5 ? 0 : between(r2, 30, 70); }
  const barHeight = lift === 'bench' ? between(r, 0.85, 1.05) : lift === 'squat' ? between(r, 1.35, 1.6) : between(r, 0.22, 0.25) + reps[0].D;
  const yawDeg = between(r, -60, 60);
  const distance = between(r, 1.4, 3.8);
  const camH = between(r, 0.15, 1.7); // phone height above the floor
  const midBar = barHeight - 0.5 * Math.max(...reps.map((x) => x.D));
  const fps = pick(r, [30, 30, 60]);
  return {
    i, lift,
    lift_: { reps, path: lift === 'bench' ? between(r, 0.05, 0.12) : between(r, 0.0, 0.05), drift: between(r, -0.03, 0.03), ecc: between(r, 0.9, 2.0), pauseBottom: lift === 'bench' ? between(r, 0, 0.8) : between(r, 0, 0.3), pauseTop: between(r, 0.3, 0.9), lead: 1.3, tail: 0.5, startsAtBottom: lift === 'deadlift', origin: [0, barHeight, 0] },
    scene: {
      w: res[0], h: res[1], hfovDeg: between(r, 60, 76),
      place: { distance, yawDeg, heightOffset: camH - midBar, aim: true, pitchDeg: between(r, -6, 6), rollDeg: between(r, -8, 8), panDeg: between(r, -8, 8) },
      lens: { k1: between(r, -0.06, 0.03), k2: 0 },
      exposure: pick(r, [1 / 30, 1 / 60, 1 / 120, 1 / 250]) * (fps === 60 ? 0.5 : 1),
      readout: between(r, 0.008, 0.03), noise: between(r, 1.5, 6), bodyShade: pick(r, [60, 95, 130, 180]),
    },
    timing: { fps, jitter: 0.0008, drop: pick(r, [0, 0, 0.01, 0.03]) },
    app: { assumedHfovDeg: 68, upErrDeg: pick(r, [0.3, 0.7, 1.2]), radiusM: 0.225 },
    seed: i + 1,
  };
}

