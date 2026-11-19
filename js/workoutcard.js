/* ═══════════════════════════════════════════════════════════════════════
 *  Workout card — a finished workout as a shareable PNG (1080 px wide).
 *  Read-only: it draws what was saved and changes nothing. Every exercise in
 *  order, every logged set as saved (weight with its unit, left/right for
 *  unilateral exercises, reps, RIR; "—" where nothing was entered). Drawn on
 *  a canvas in the browser: no outside service, works offline.
 *    WorkoutCard.open(workout)  → preview with Download PNG (Share where a
 *                                  phone can't download)
 * ═══════════════════════════════════════════════════════════════════════ */
(function () {
  const W = 1080, PAD = 64, INK = '#111114', INK2 = '#6B6F78', LINE = '#E7E8EC', BG = '#F6F6F8', GREEN = '#22A355', CARD = '#FFFFFF';
  const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", "Segoe UI", system-ui, sans-serif';
  const LOGO = 'arete-logo.png';
  const DASH = '—';
  const blank = (v) => v === '' || v == null || (typeof v === 'number' && !Number.isFinite(v));

  // ── What goes on the card ──
  /** The saved workout as rows to draw: logged (completed) sets only, in their order. */
  function cardData(w) {
    const exercises = (w.exercises || []).map((ex) => {
      let n = 0;
      const sets = (ex.sets || []).filter((s) => s && s.completed).map((s) => {
        const unit = s.unit || 'kg';
        const weight = ex.unilateral
          ? (blank(s.weightL) && blank(s.weightR) ? DASH : `L ${blank(s.weightL) ? DASH : s.weightL} · R ${blank(s.weightR) ? DASH : s.weightR} ${unit}`)
          : (blank(s.weight) ? DASH : `${s.weight} ${unit}`);
        return { label: s.type === 'warmup' ? 'W' : String(++n), weight, reps: blank(s.reps) ? DASH : String(s.reps), rir: blank(s.rir) ? DASH : String(s.rir), warm: s.type === 'warmup' };
      });
      return { name: String(ex.name || 'Exercise'), sets };
    }).filter((e) => e.sets.length);
    const when = new Date(w.completedAt || Date.now());
    return {
      name: String(w.name || 'Workout'),
      date: when.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
      day: `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')}`,
      exercises,
      setCount: exercises.reduce((k, e) => k + e.sets.filter((s) => !s.warm).length, 0),
    };
  }

  // ── Drawing ──
  function wrap(ctx, text, maxW) {
    const words = text.split(/\s+/), lines = [];
    let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width <= maxW || !line) line = t; else { lines.push(line); line = w; }
    }
    if (line) lines.push(line);
    // A single word wider than the card: break it.
    return lines.flatMap((l) => {
      if (ctx.measureText(l).width <= maxW) return [l];
      const out = []; let cur = '';
      for (const ch of l) { if (ctx.measureText(cur + ch).width > maxW && cur) { out.push(cur); cur = ch; } else cur += ch; }
      return cur ? [...out, cur] : out;
    });
  }
  function roundRect(ctx, x, y, w, h, r, fill, stroke) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
  }
  const font = (weight, size) => `${weight} ${size}px ${FONT}`;
  // Columns of a set row (x of each column's left edge, inside a section).
  const COLS = { set: 0, weight: 120, reps: 640, rir: 820 };

  /** Lays the card out (dry: heights only) or draws it. Returns the total height. */
  function layout(ctx, d, logo, draw) {
    const inner = W - 2 * PAD, sec = inner - 2 * 40;
    let y = PAD;
    // Banner: the logo, then WORKOUT SUMMARY, the workout's name, the date and a one-line count.
    const bh0 = y;
    y += 56;
    const logoH = 132, logoW = logo ? (logo.naturalWidth / logo.naturalHeight) * logoH : 0;
    if (draw && logo) ctx.drawImage(logo, PAD + 48, y, logoW, logoH);
    if (draw && !logo) { ctx.font = font(800, 72); ctx.fillStyle = INK; ctx.fillText('ARETE', PAD + 48, y + 96); }
    y += logoH + 44;
    ctx.font = font(700, 26);
    if (draw) { ctx.fillStyle = GREEN; ctx.letterSpacing = '4px'; ctx.fillText('WORKOUT SUMMARY', PAD + 48, y); ctx.letterSpacing = '0px'; }
    y += 22;
    ctx.font = font(800, 68);
    const nameLines = wrap(ctx, d.name, inner - 96);
    for (const l of nameLines) { y += 76; if (draw) { ctx.fillStyle = INK; ctx.fillText(l, PAD + 48, y); } }
    y += 60; ctx.font = font(500, 32);
    if (draw) { ctx.fillStyle = INK2; ctx.fillText(d.date, PAD + 48, y); }
    y += 48; ctx.font = font(600, 28);
    if (draw) {
      const ex = d.exercises.length;
      ctx.fillStyle = INK; ctx.fillText(`${ex} exercise${ex === 1 ? '' : 's'}  ·  ${d.setCount} working set${d.setCount === 1 ? '' : 's'}`, PAD + 48, y);
    }
    y += 52;
    if (draw) { const h = y - bh0; ctx.save(); ctx.globalCompositeOperation = 'destination-over'; roundRect(ctx, PAD, bh0, inner, h, 40, CARD, LINE); ctx.restore(); }
    y += 28;
    // One section per exercise: its name, then SET / WEIGHT / REPS / RIR and a row per set.
    for (const ex of d.exercises) {
      const top = y, x0 = PAD + 40;
      y += 54; ctx.font = font(800, 34);
      for (const l of wrap(ctx, ex.name.toUpperCase(), sec)) { if (draw) { ctx.fillStyle = INK; ctx.fillText(l, x0, y); } y += 44; }
      y += 6; ctx.font = font(700, 22);
      if (draw) {
        ctx.fillStyle = INK2; ctx.letterSpacing = '2px';
        for (const [k, t] of [['set', 'SET'], ['weight', 'WEIGHT'], ['reps', 'REPS'], ['rir', 'RIR']]) ctx.fillText(t, x0 + COLS[k], y);
        ctx.letterSpacing = '0px';
      }
      y += 22;
      for (const s of ex.sets) {
        if (draw) { ctx.fillStyle = LINE; ctx.fillRect(x0, y, sec, 2); }
        y += 56; ctx.font = font(600, 34);
        if (draw) {
          ctx.fillStyle = s.warm ? INK2 : GREEN; ctx.fillText(s.label, x0 + COLS.set, y);
          ctx.fillStyle = INK; ctx.font = font(600, s.weight.length > 18 ? 28 : 34);
          ctx.fillText(s.weight, x0 + COLS.weight, y);
          ctx.font = font(600, 34); ctx.fillText(s.reps, x0 + COLS.reps, y); ctx.fillText(s.rir, x0 + COLS.rir, y);
        }
        y += 24;
      }
      y += 18;
      if (draw) { ctx.save(); ctx.globalCompositeOperation = 'destination-over'; roundRect(ctx, PAD, top, inner, y - top, 32, CARD, LINE); ctx.restore(); }
      y += 24;
    }
    if (!d.exercises.length) { y += 40; ctx.font = font(500, 30); if (draw) { ctx.fillStyle = INK2; ctx.fillText('No sets were logged.', PAD + 40, y); } y += 40; }
    y += 8; ctx.font = font(600, 24);
    if (draw) { ctx.fillStyle = INK2; ctx.textAlign = 'center'; ctx.fillText('Tracked with ARETE', W / 2, y + 20); ctx.textAlign = 'left'; }
    return y + 20 + PAD;
  }

  let logoP = null;
  function loadLogo() {
    if (!logoP) logoP = new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => { logoP = null; res(null); }; im.src = LOGO; });
    return logoP;
  }

  /** The card as a canvas (1080 px wide, as tall as the workout needs). */
  async function render(w) {
    const d = cardData(w), logo = await loadLogo();
    const c = document.createElement('canvas'), ctx = c.getContext('2d');
    c.width = W; c.height = 10;
    const H = Math.ceil(layout(ctx, d, logo, false));
    c.height = H;
    ctx.textBaseline = 'alphabetic';
    // Sections are drawn text first, their cards behind (destination-over), so the page colour goes last.
    layout(ctx, d, logo, true);
    ctx.save(); ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H); ctx.restore();
    return { canvas: c, data: d };
  }

  const fileName = (d) => `ARETE_${d.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'Workout'}_${d.day}.png`;

  // ── Preview ──
  async function open(w) {
    if (!w) return;
    document.getElementById('wcard-modal')?.remove();
    const m = document.createElement('div');
    m.id = 'wcard-modal';
    m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-label', 'Workout card');
    m.innerHTML = `<style>
      #wcard-modal{position:fixed;inset:0;z-index:1000;background:rgba(17,17,20,.55);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;padding:max(16px,env(safe-area-inset-top)) 16px max(16px,env(safe-area-inset-bottom))}
      #wcard-modal .wc-box{background:#fff;border-radius:24px;width:min(460px,100%);max-height:100%;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.25)}
      #wcard-modal .wc-hd{display:flex;align-items:center;justify-content:space-between;padding:14px 16px 10px;font:600 16px/1.2 ${FONT};color:${INK}}
      #wcard-modal .wc-x{border:0;background:#F1F1F4;color:${INK};width:34px;height:34px;border-radius:50%;font-size:20px;line-height:1;cursor:pointer}
      #wcard-modal .wc-view{flex:1;overflow:auto;padding:0 16px;background:#fff}
      #wcard-modal .wc-view img{display:block;width:100%;height:auto;border-radius:14px;border:1px solid ${LINE}}
      #wcard-modal .wc-acts{display:flex;gap:10px;padding:14px 16px 16px}
      #wcard-modal .wc-acts button{flex:1;height:48px;border-radius:14px;border:0;font:600 16px ${FONT};cursor:pointer}
      #wcard-modal .wc-dl{background:${INK};color:#fff}
      #wcard-modal .wc-sh{background:#F1F1F4;color:${INK}}
      #wcard-modal .wc-wait{padding:60px 0;text-align:center;color:${INK2};font:500 14px ${FONT}}
    </style>
    <div class="wc-box"><div class="wc-hd"><span>Workout card</span><button class="wc-x" aria-label="Close">×</button></div>
      <div class="wc-view"><div class="wc-wait">Making your card…</div></div>
      <div class="wc-acts"><button class="wc-dl" disabled>Download PNG</button><button class="wc-sh" hidden>Share</button></div></div>`;
    document.body.appendChild(m);
    const close = () => { m.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    m.querySelector('.wc-x').onclick = close;
    m.addEventListener('click', (e) => { if (e.target === m) close(); });
    let r;
    try { r = await render(w); } catch (err) { m.querySelector('.wc-view').innerHTML = `<div class="wc-wait">Couldn’t make the card.</div>`; return; }
    const blob = await new Promise((res) => r.canvas.toBlob(res, 'image/png'));
    const url = URL.createObjectURL(blob), name = fileName(r.data);
    const view = m.querySelector('.wc-view'); view.innerHTML = '';
    const img = new Image(); img.alt = `Workout card: ${r.data.name}, ${r.data.date}`; img.src = url; view.appendChild(img);
    const file = typeof File === 'function' ? new File([blob], name, { type: 'image/png' }) : null;
    const canShare = !!(file && navigator.canShare && navigator.canShare({ files: [file] }));
    const dl = m.querySelector('.wc-dl'), sh = m.querySelector('.wc-sh');
    dl.disabled = false;
    dl.onclick = () => { const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); };
    // Where a phone saves images through the share sheet (iPhone apps, some browsers), offer it too.
    if (canShare) { sh.hidden = false; sh.onclick = () => navigator.share({ files: [file], title: r.data.name }).catch(() => {}); }
    const _close = close;
    m.querySelector('.wc-x').onclick = () => { URL.revokeObjectURL(url); _close(); };
  }

  window.WorkoutCard = { open, render, cardData, fileName };
})();
