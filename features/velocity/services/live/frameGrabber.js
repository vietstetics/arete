// Grey pixels from a video element (or any canvas image source), for the
// plate tracker. Draws only the requested rectangle, already scaled to the
// size the tracker wants (the browser does the scaling on the GPU), then
// reads it back once. The front camera's picture is mirrored only on screen
// (CSS); the frames drawn here are not, which is what the measurement needs.

import { fromRGBA } from '../vision/image.js';

export function createFrameGrabber() {
  const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  return {
    /** Rectangle (sx, sy, sw, sh) of the source, drawn at ow × oh, as a grey image. */
    grab(source, sx, sy, sw, sh, ow, oh) {
      if (cv.width !== ow) cv.width = ow;
      if (cv.height !== oh) cv.height = oh;
      ctx.drawImage(source, sx, sy, sw, sh, 0, 0, ow, oh);
      return fromRGBA(ctx.getImageData(0, 0, ow, oh).data, ow, oh);
    },
  };
}
