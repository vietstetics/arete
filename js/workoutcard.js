/* ═══════════════════════════════════════════════════════════════════════
 *  Workout card — a finished workout as a shareable PNG, Story size
 *  (1080 × 1920): every exercise fitted in, in a grid of compact tiles.
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
          ? (blank(s.weightL) && blank(s.weightR) ? DASH : `R ${blank(s.weightR) ? DASH : s.weightR} · L ${blank(s.weightL) ? DASH : s.weightL} ${unit}`)
          : (blank(s.weight) ? DASH : `${s.weight} ${unit}`);
        return { label: s.type === 'warmup' ? 'W' : String(++n), weight, reps: ex.unilateral && !(blank(s.repsR) && blank(s.repsL)) ? `R ${blank(s.repsR) ? DASH : s.repsR} · L ${blank(s.repsL) ? DASH : s.repsL}` : blank(s.reps) ? DASH : String(s.reps), rir: blank(s.rir) ? DASH : String(s.rir), warm: s.type === 'warmup' };
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

  // ── The compact card: Story size (1080 × 1920), every exercise in a grid of tiles ──
  const CARD_H = 1920, GAP = 18, FOOT = 84;

  /** The banner: logo, WORKOUT SUMMARY, the workout's name (up to two lines), date · counts. Returns its bottom. */
  function header(ctx, d, logo, draw) {
    const inner = W - 2 * PAD, x = PAD + 44;
    let y = PAD, top = y;
    y += 40;
    const logoH = 96, logoW = logo ? (logo.naturalWidth / logo.naturalHeight) * logoH : 0;
    if (draw && logo) ctx.drawImage(logo, x, y, logoW, logoH);
    if (draw && !logo) { ctx.font = font(800, 56); ctx.fillStyle = INK; ctx.fillText('ARETE', x, y + 72); }
    y += logoH + 40;
    ctx.font = font(700, 22);
    if (draw) { ctx.fillStyle = GREEN; ctx.letterSpacing = '4px'; ctx.fillText('WORKOUT SUMMARY', x, y); ctx.letterSpacing = '0px'; }
    // The name at the largest size (60 down to 36 px) that fits two lines.
    let size = 60, lines;
    for (; size >= 36; size -= 4) { ctx.font = font(800, size); lines = wrap(ctx, d.name, inner - 88); if (lines.length <= 2) break; }
    for (const l of lines) { y += size * 1.12; if (draw) { ctx.fillStyle = INK; ctx.fillText(l, x, y); } }
    y += 46; ctx.font = font(500, 28);
    const ex = d.exercises.length, line = `${d.date}  ·  ${ex} exercise${ex === 1 ? '' : 's'}  ·  ${d.setCount} set${d.setCount === 1 ? '' : 's'}`;
    if (draw) { ctx.fillStyle = INK2; ctx.fillText(line, x, y); }
    y += 40;
    if (draw) { ctx.save(); ctx.globalCompositeOperation = 'destination-over'; roundRect(ctx, PAD, top, inner, y - top, 36, CARD, LINE); ctx.restore(); }
    return y;
  }

  /**
   * One exercise's tile at text scale k and width tw: its name, then one line per set — the set, the
   * weight, × reps and RIR. Returns its height (drawn at x, y when draw), or null if a set's line doesn't
   * fit the width at this size (then a smaller size or fewer columns is tried).
   */
  function tile(ctx, ex, k, tw, x, y, draw) {
    const pad = 22 * k, inW = tw - 2 * pad, nameF = 26 * k, rowF = 24 * k, rowH = 34 * k, labW = 40 * k;
    ctx.font = font(600, rowF);
    for (const st of ex.sets) {
      const need = labW + ctx.measureText(st.weight).width + 18 * k + ctx.measureText('× ' + st.reps).width + 22 * k + ctx.measureText('RIR ' + st.rir).width;
      if (need > inW) return null;
    }
    ctx.font = font(800, nameF);
    const names = wrap(ctx, ex.name.toUpperCase(), inW);
    let yy = y + pad;
    for (const l of names) { yy += nameF * 1.15; if (draw) { ctx.fillStyle = INK; ctx.fillText(l, x + pad, yy); } }
    yy += 8 * k;
    for (const st of ex.sets) {
      yy += rowH;
      if (draw) {
        ctx.font = font(700, rowF); ctx.fillStyle = st.warm ? INK2 : GREEN; ctx.fillText(st.label, x + pad, yy);
        ctx.font = font(600, rowF); ctx.fillStyle = INK; ctx.fillText(st.weight, x + pad + labW, yy);
        ctx.textAlign = 'right';
        const rir = 'RIR ' + st.rir, rirW = ctx.measureText(rir).width;
        ctx.fillStyle = INK2; ctx.fillText(rir, x + tw - pad, yy);
        ctx.fillStyle = INK; ctx.fillText('× ' + st.reps, x + tw - pad - rirW - 22 * k, yy);
        ctx.textAlign = 'left';
      }
    }
    yy += pad;
    if (draw) { ctx.save(); ctx.globalCompositeOperation = 'destination-over'; roundRect(ctx, x, y, tw, yy - y, 26 * k, CARD, LINE); ctx.restore(); }
    return yy - y;
  }

  /**
   * The largest text (and then the fewest columns) at which every exercise fits the card, in order, down
   * each column then across. Nothing is ever left out: if even the smallest size won't fit, the card grows
   * taller instead.
   */
  function plan(ctx, d, top) {
    const inner = W - 2 * PAD, avail = CARD_H - top - GAP - FOOT;
    const place = (k, cols, limit) => {
      const tw = (inner - (cols - 1) * GAP) / cols, cols_ = [[]];
      let h = 0;
      for (const ex of d.exercises) {
        const th = tile(ctx, ex, k, tw, 0, 0, false);
        if (th === null) return null;
        if (h > 0 && h + th > limit) { if (cols_.length === cols) return null; cols_.push([]); h = 0; }
        cols_[cols_.length - 1].push({ ex, th }); h += th + GAP;
      }
      return { k, cols, tw, cols_, height: Math.max(...cols_.map((c) => c.reduce((s2, t) => s2 + t.th + GAP, 0))) };
    };
    // Then the columns evened out: the shortest column height that still takes everything, in order.
    const balanced = (k, cols) => {
      let lo = 0, hi = avail, best = place(k, cols, avail);
      for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2, p = place(k, cols, mid); if (p) { best = p; hi = mid; } else lo = mid; }
      return best;
    };
    for (let k = 2.4; k >= 0.6 - 1e-9; k -= 0.05) for (let cols = 1; cols <= 3; cols++) if (place(k, cols, avail)) return { ...balanced(k, cols), H: CARD_H };
    // A very long workout: two columns at a small readable size, as tall as it takes.
    const total = d.exercises.reduce((s2, ex) => s2 + (tile(ctx, ex, 0.6, (inner - GAP) / 2, 0, 0, false) ?? 0) + GAP, 0);
    const p = place(0.6, 2, total / 2 + 400) || place(0.6, 3, total);
    return { ...p, H: Math.ceil(top + GAP + p.height + FOOT) };
  }

  /** Lays the whole card out and draws it. Returns its height. */
  function layout(ctx, d, logo, draw, pl) {
    const top = header(ctx, d, logo, draw);
    if (!pl) pl = d.exercises.length ? plan(ctx, d, top) : { cols_: [], H: CARD_H };
    if (draw) {
      pl.cols_.forEach((col, c) => {
        let y = top + GAP;
        const x = PAD + c * (pl.tw + GAP);
        for (const t of col) { tile(ctx, t.ex, pl.k, pl.tw, x, y, true); y += t.th + GAP; }
      });
      if (!d.exercises.length) { ctx.font = font(500, 30); ctx.fillStyle = INK2; ctx.fillText('No sets were logged.', PAD + 44, top + 80); }
      ctx.font = font(600, 24); ctx.fillStyle = INK2; ctx.textAlign = 'center'; ctx.fillText('Tracked with ARETE', W / 2, pl.H - FOOT / 2 + 8); ctx.textAlign = 'left';
    }
    return pl;
  }

  let logoP = null;
  function loadLogo() {
    if (!logoP) logoP = new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => { logoP = null; res(null); }; im.src = LOGO; });
    return logoP;
  }

  /** The card as a canvas: 1080 × 1920 (taller only for a workout too long to fit at a readable size). */
  async function render(w) {
    const d = cardData(w), logo = await loadLogo();
    const c = document.createElement('canvas'), ctx = c.getContext('2d');
    c.width = W; c.height = 10;
    const pl = layout(ctx, d, logo, false), H = pl.H;
    c.height = H;
    ctx.textBaseline = 'alphabetic';
    // Text first, the cards behind it (destination-over), the page colour last.
    layout(ctx, d, logo, true, pl);
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
