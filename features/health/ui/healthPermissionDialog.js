// Pre-permission primer — shown BEFORE the OS permission screen, explaining
// what Arete wants to read, why each type is useful, that access is optional,
// and that the user can disconnect at any time. Also captures the initial
// history range (today / 7 / 30 / 90 days).

const WHY = [
  ['Steps & distance', 'feed your step tracker and daily activity'],
  ['Sleep sessions', 'suggest last night’s sleep in the Morning Check-In — you confirm before it’s used'],
  ['Workouts', 'appear in your training history alongside Arete-logged sessions'],
  ['Heart rate, resting HR & HRV', 'optional readiness inputs for your day score'],
  ['Active calories', 'complete your daily activity summary'],
  ['Weight & body fat', 'track progress over time'],
];

export function showPermissionPrimer(providerName, onProceed) {
  let el = document.getElementById('hlt-primer');
  if (!el) {
    el = document.createElement('div');
    el.id = 'hlt-primer';
    el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:400;display:flex;align-items:center;justify-content:center;padding:18px';
    document.body.appendChild(el);
  }
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  el.innerHTML = `
    <div style="background:#fff;border-radius:18px;box-shadow:0 12px 40px rgba(16,40,28,.16);width:460px;max-width:100%;padding:22px;max-height:88vh;overflow-y:auto">
      <div style="font-size:16px;font-weight:800;margin-bottom:6px">Connect ${esc(providerName)}</div>
      <div style="font-size:12.5px;color:#6E6E73;line-height:1.6;margin-bottom:12px">
        Arete asks to <b>read</b> the data below — it never writes to ${esc(providerName)},
        never uploads your health data, and never uses it for advertising.
        Access is optional and you can disconnect any time.
      </div>
      ${WHY.map(([what, why]) => `
        <div style="display:flex;gap:8px;font-size:12px;line-height:1.5;margin-bottom:7px">
          <span style="color:#1DA462;font-weight:800">✓</span>
          <span><b>${esc(what)}</b> — ${esc(why)}</span>
        </div>`).join('')}
      <div style="font-size:11.5px;font-weight:700;margin:14px 0 7px">Import history from</div>
      <div id="hlt-range" style="display:flex;gap:7px;flex-wrap:wrap">
        ${[['1', 'Today'], ['7', '7 days'], ['30', '30 days'], ['90', '90 days']].map(([v, l], i) => `
          <button data-v="${v}" class="${i === 1 ? 'on' : ''}" style="flex:1;min-width:70px;padding:9px;border:1px solid ${i === 1 ? '#1DA462' : 'rgba(0,0,0,.1)'};border-radius:10px;background:${i === 1 ? 'rgba(29,164,98,.1)' : '#fff'};font-size:12.5px;font-weight:600;cursor:pointer">${l}</button>`).join('')}
      </div>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button id="hlt-primer-cancel" style="flex:1;padding:12px;border-radius:11px;border:1px solid rgba(0,0,0,.1);background:#fff;font-size:13px;font-weight:700;cursor:pointer">Not now</button>
        <button id="hlt-primer-go" style="flex:2;padding:12px;border-radius:11px;border:none;background:#1D1D1F;color:#fff;font-size:13px;font-weight:700;cursor:pointer">Continue</button>
      </div>
    </div>`;
  let days = 7;
  el.querySelectorAll('#hlt-range button').forEach((b) => {
    b.onclick = () => {
      days = parseInt(b.dataset.v, 10);
      el.querySelectorAll('#hlt-range button').forEach((x) => {
        const on = x === b;
        x.style.borderColor = on ? '#1DA462' : 'rgba(0,0,0,.1)';
        x.style.background = on ? 'rgba(29,164,98,.1)' : '#fff';
      });
    };
  });
  el.querySelector('#hlt-primer-cancel').onclick = () => el.remove();
  el.querySelector('#hlt-primer-go').onclick = () => { el.remove(); onProceed(days); };
  el.onclick = (e) => { if (e.target === el) el.remove(); };
}
