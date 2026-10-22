// Use the video's own frame clock, never the time inference happened to run.
// For live capture, offset mediaTime once into the motion sensor clock.
export function createFrameClock() {
  let offset = null, last = -Infinity, lastMedia = -Infinity;
  return {
    reset() { offset = null; last = -Infinity; lastMedia = -Infinity; },
    time(mediaTime, nowMs, { file = false, captureTime } = {}) {
      if (!Number.isFinite(mediaTime) || !Number.isFinite(nowMs) || mediaTime <= lastMedia) return null;
      if (offset === null) offset = (Number.isFinite(captureTime) ? captureTime : nowMs) - mediaTime * 1000;
      const t = file ? mediaTime * 1000 : Number.isFinite(captureTime) ? captureTime : offset + mediaTime * 1000;
      if (!Number.isFinite(t) || t <= last) return null;
      last = t;
      lastMedia = mediaTime;
      return t;
    },
  };
}
