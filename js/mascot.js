/* ============================================================================
 *  Arete mascot — a friendly emerald muscle-buddy.
 *  Inline SVG + CSS animations only (no assets, no dependencies): he bobs,
 *  waves one arm, pumps a bicep with the other, and blinks now and then.
 *  Usage:  <div id="spot"></div>  →  AreteMascot.mount(el, 140)
 * ==========================================================================*/
(function () {
  const CSS = `
.am-bob{animation:am-bob 3.4s ease-in-out infinite}
.am-wave{animation:am-wave 1.6s ease-in-out infinite;transform-box:view-box;transform-origin:162px 102px}
.am-flex{animation:am-flex 3.4s ease-in-out infinite;transform-box:view-box;transform-origin:60px 102px}
.am-eye{animation:am-blink 4.6s infinite;transform-box:fill-box;transform-origin:center}
.am-shadow{animation:am-shadow 3.4s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
@keyframes am-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
@keyframes am-wave{0%,100%{transform:rotate(10deg)}50%{transform:rotate(36deg)}}
@keyframes am-flex{0%,100%{transform:rotate(0deg)}50%{transform:rotate(-7deg)}}
@keyframes am-blink{0%,91%,100%{transform:scaleY(1)}94%,96%{transform:scaleY(.08)}}
@keyframes am-shadow{0%,100%{transform:scaleX(1);opacity:.16}50%{transform:scaleX(.88);opacity:.10}}
@media(prefers-reduced-motion:reduce){.am-bob,.am-wave,.am-flex,.am-eye,.am-shadow{animation:none!important}}
`;

  const SVG = `
<svg width="__W__" viewBox="0 0 220 205" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="display:block">
  <defs>
    <linearGradient id="am-body" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2ECC7C"/><stop offset="1" stop-color="#159457"/>
    </linearGradient>
    <linearGradient id="am-head" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3BD98B"/><stop offset="1" stop-color="#1DA462"/>
    </linearGradient>
  </defs>

  <ellipse class="am-shadow" cx="110" cy="197" rx="54" ry="7" fill="#10281C" opacity=".16"/>

  <g class="am-bob">
    <!-- legs -->
    <rect x="86" y="154" width="23" height="38" rx="11.5" fill="#128A4E"/>
    <rect x="111" y="154" width="23" height="38" rx="11.5" fill="#128A4E"/>

    <!-- waving arm (his left) -->
    <g class="am-wave" stroke="#1FAF63" stroke-linecap="round">
      <line x1="162" y1="102" x2="190" y2="84" stroke-width="21"/>
      <line x1="190" y1="84" x2="197" y2="56" stroke-width="18"/>
      <circle cx="199" cy="47" r="12.5" fill="#17A05B" stroke="none"/>
    </g>

    <!-- flexing arm (his right) -->
    <g class="am-flex" stroke="#1FAF63" stroke-linecap="round">
      <line x1="60" y1="102" x2="35" y2="130" stroke-width="21"/>
      <circle cx="46" cy="110" r="12" fill="#1FAF63" stroke="none"/>
      <line x1="35" y1="130" x2="30" y2="94" stroke-width="18"/>
      <circle cx="29" cy="87" r="12" fill="#17A05B" stroke="none"/>
    </g>

    <!-- torso: broad shoulders, proud chest -->
    <circle cx="58" cy="100" r="17" fill="url(#am-body)"/>
    <circle cx="162" cy="100" r="17" fill="url(#am-body)"/>
    <path d="M110,78 C70,78 48,96 46,124 C44,150 66,168 110,168 C154,168 176,150 174,124 C172,96 150,78 110,78 Z" fill="url(#am-body)"/>
    <!-- pecs -->
    <path d="M80,106 Q94,120 107,109" stroke="#0F7A45" stroke-width="4" stroke-linecap="round" opacity=".6"/>
    <path d="M113,109 Q126,120 140,106" stroke="#0F7A45" stroke-width="4" stroke-linecap="round" opacity=".6"/>
    <!-- belly + a cute four-pack -->
    <ellipse cx="110" cy="141" rx="30" ry="21" fill="#7FE0AE" opacity=".85"/>
    <path d="M110,126 L110,155" stroke="#4CC98F" stroke-width="3" stroke-linecap="round" opacity=".9"/>
    <path d="M94,140 L126,140" stroke="#4CC98F" stroke-width="3" stroke-linecap="round" opacity=".9"/>

    <!-- head -->
    <circle cx="110" cy="52" r="35" fill="url(#am-head)"/>
    <ellipse cx="110" cy="61" rx="25" ry="19" fill="#8CE7B8" opacity=".5"/>
    <!-- raised friendly brows -->
    <path d="M88,37 Q96,31 104,35" stroke="#0E2F1F" stroke-width="3.5" stroke-linecap="round"/>
    <path d="M116,35 Q124,31 132,37" stroke="#0E2F1F" stroke-width="3.5" stroke-linecap="round"/>
    <!-- eyes (blink) -->
    <g class="am-eye">
      <circle cx="97" cy="48" r="7.5" fill="#fff"/>
      <circle cx="97.6" cy="49" r="3.9" fill="#0E2F1F"/>
      <circle cx="95.8" cy="46.6" r="1.5" fill="#fff"/>
    </g>
    <g class="am-eye">
      <circle cx="123" cy="48" r="7.5" fill="#fff"/>
      <circle cx="123.6" cy="49" r="3.9" fill="#0E2F1F"/>
      <circle cx="121.8" cy="46.6" r="1.5" fill="#fff"/>
    </g>
    <!-- big smile + blush -->
    <path d="M92,63 Q110,82 128,63" stroke="#0E2F1F" stroke-width="4.5" stroke-linecap="round"/>
    <circle cx="86" cy="60" r="5.5" fill="#B9F2D4" opacity=".8"/>
    <circle cx="134" cy="60" r="5.5" fill="#B9F2D4" opacity=".8"/>
  </g>
</svg>`;

  function ensureCss() {
    if (document.getElementById('am-css')) return;
    const s = document.createElement('style');
    s.id = 'am-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  window.AreteMascot = {
    mount(el, size) {
      if (!el) return;
      ensureCss();
      el.innerHTML = SVG.replace('__W__', String(size || 140));
    },
  };
})();
