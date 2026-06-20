// Scoped styles for the step components. Injected once; uses the app's global
// theme CSS variables (with fallbacks) so it matches every page.
let injected = false;
export function injectStepStyles() {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const css = `
  .jstep-card{background:#fff;border:1px solid var(--bd,#e6e6e6);border-radius:16px;padding:18px 18px 16px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
  .jstep-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
  .jstep-title{font-size:14px;font-weight:600;color:var(--t1,#1d1d1f);letter-spacing:-.01em}
  .jstep-badge{font-size:10px;font-weight:600;color:var(--t3,#86868b);background:var(--s2,#f2f2f2);border-radius:6px;padding:2px 7px;text-transform:uppercase;letter-spacing:.03em}
  .jstep-top{display:flex;align-items:center;gap:16px}
  .jstep-ring{position:relative;width:84px;height:84px;flex-shrink:0}
  .jstep-ring svg{transform:rotate(-90deg)}
  .jstep-ring .jstep-pct{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:700;color:var(--gr,#1da462)}
  .jstep-nums{min-width:0}
  .jstep-big{font-size:24px;font-weight:700;color:var(--t1,#1d1d1f);letter-spacing:-.02em;line-height:1.1}
  .jstep-big span{font-size:15px;font-weight:500;color:var(--t3,#86868b)}
  .jstep-rem{font-size:13px;color:var(--t2,#6e6e73);margin-top:3px}
  .jstep-rem.done{color:var(--gr,#1da462);font-weight:600}
  .jstep-stats{display:flex;gap:10px;margin-top:14px;padding-top:13px;border-top:1px solid var(--bd,#eee)}
  .jstep-stat{flex:1}
  .jstep-stat .v{font-size:15px;font-weight:600;color:var(--t1,#1d1d1f)}
  .jstep-stat .l{font-size:11px;color:var(--t3,#86868b);margin-top:1px}
  .jstep-note{font-size:11px;color:var(--t3,#86868b);line-height:1.45;margin-top:12px}
  .jstep-actions{display:flex;gap:8px;margin-top:12px}
  .jstep-btn{flex:1;text-align:center;font-size:12.5px;font-weight:600;padding:9px 12px;border-radius:10px;border:1px solid var(--bd,#e0e0e0);background:#fff;color:var(--t1,#1d1d1f);cursor:pointer;text-decoration:none}
  .jstep-btn.primary{background:var(--gr,#1da462);border-color:var(--gr,#1da462);color:#fff}
  .jstep-btn:active{transform:scale(.99)}
  /* permission / manual panel */
  .jstep-panel{background:#fff;border:1px solid var(--bd,#e6e6e6);border-radius:16px;padding:18px}
  .jstep-panel h3{font-size:14px;font-weight:600;color:var(--t1,#1d1d1f);margin:0 0 6px}
  .jstep-panel p{font-size:12.5px;color:var(--t2,#6e6e73);line-height:1.55;margin:0 0 12px}
  .jstep-row{display:flex;gap:8px;align-items:center}
  .jstep-input{flex:1;font-size:14px;padding:10px 12px;border:1px solid var(--bd,#ddd);border-radius:10px;color:var(--t1,#1d1d1f);background:#fff;-webkit-appearance:none}
  /* history */
  .jstep-bars{display:flex;align-items:flex-end;gap:8px;height:120px;margin:6px 0 4px}
  .jstep-col{flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;justify-content:flex-end;height:100%}
  .jstep-bar{width:100%;max-width:30px;border-radius:6px 6px 3px 3px;background:var(--s4,#dcdcdc);transition:height .3s}
  .jstep-bar.met{background:var(--gr,#1da462)}
  .jstep-col .d{font-size:10px;color:var(--t3,#86868b)}
  .jstep-tiles{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:14px}
  .jstep-tile{background:var(--s2,#f7f7f8);border-radius:12px;padding:12px 14px}
  .jstep-tile .v{font-size:18px;font-weight:700;color:var(--t1,#1d1d1f);letter-spacing:-.02em}
  .jstep-tile .l{font-size:11px;color:var(--t3,#86868b);margin-top:2px}
  `;
  const style = document.createElement('style');
  style.id = 'jstep-styles';
  style.textContent = css;
  document.head.appendChild(style);
}
