// Starting a video the browser may refuse to start on its own. Browsers only
// let a page start a video from a tap, or a muted one without; some refuse
// even that (an iPhone in Low Power Mode, autoplay switched off) and the tap's
// permission runs out while the tracker downloads. Then play() fails with
// NotAllowedError ("The request is not allowed by the user agent"). Here the
// video is muted and inline first, and if it's still refused, a button asks
// for the one tap the browser needs.

/** Plays `video`; resolves once it's playing (after a tap, if the browser wanted one). Other errors reject. */
export function playVideo(video, { label = 'Tap to start the video' } = {}) {
  video.muted = true;
  video.playsInline = true;
  return video.play().catch((err) => {
    if (!err || err.name !== 'NotAllowedError') throw err;
    return new Promise((resolve, reject) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.setAttribute('style', 'position:fixed;inset:auto 16px calc(24px + env(safe-area-inset-bottom,0px));z-index:9999;padding:16px;border:0;border-radius:12px;background:#171B12;color:#fff;font:600 16px/1.2 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.3)');
      btn.onclick = () => { btn.remove(); video.play().then(resolve, reject); };
      document.body.appendChild(btn);
      btn.focus();
    });
  });
}
