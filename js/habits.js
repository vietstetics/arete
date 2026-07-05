/* ============================================================================
 *  Arete Habits — a quiet RPG.
 *  Each habit is a skill you level by checking in daily. XP, levels and the
 *  combo multiplier are all DERIVED from the check-in history on every read,
 *  so undoing a check-in rolls everything back exactly — nothing drifts.
 *
 *  Mechanics (habit-strength science, Lally et al. 2010):
 *  - 10 base XP per check-in × combo multiplier.
 *  - Combo: +0.05 per consecutive day, capped at 1.5×. One missed day
 *    FREEZES it (a single miss doesn't derail habit formation). Two misses
 *    in a row halve it (floor 1.0×). Nothing ever resets to zero.
 *  - Levels: Novice → Apprentice → Adept → Expert → Automatic. Thresholds
 *    are tuned so a fully consistent habit reaches Automatic around day
 *    ~65 (automaticity averages ~66 days, range 18–254).
 *  - Perfect day: every skill checked in on the same date → +15 bonus XP
 *    to the character total.
 *
 *  Storage: localStorage 'arete_skills' = [{id,name,cue,createdAt,checkins}]
 *  (one-time migration from the earlier arete_habits/arete_habit_logs shape).
 * ==========================================================================*/
(function () {
  const KEY = 'arete_skills';

  const BASE_XP = 10, MAX_MULT = 1.5, MULT_STEP = 0.05, PERFECT_XP = 15, CHAR_LVL_XP = 500;
  const LEVELS = [
    { name: 'Novice',     at: 0   },
    { name: 'Apprentice', at: 150 },   // ≈ day 12 at full consistency
    { name: 'Adept',      at: 400 },   // ≈ day 30
    { name: 'Expert',     at: 700 },   // ≈ day 48
    { name: 'Automatic',  at: 950 },   // ≈ day 65 — Lally's ~66-day average
  ];

  function dstr(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  function today() { return dstr(new Date()); }
  function fromStr(s) { return new Date(s + 'T00:00:00'); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function read() { try { const v = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(v) ? v : null; } catch { return null; } }
  function write(list) { localStorage.setItem(KEY, JSON.stringify(list)); }

  // One-time migration from the previous habits system so no data is lost.
  function migrate() {
    let habits = [], logs = [];
    try { habits = JSON.parse(localStorage.getItem('arete_habits')) || []; } catch {}
    try { logs = JSON.parse(localStorage.getItem('arete_habit_logs')) || []; } catch {}
    return habits.map(h => {
      const checkins = {};
      logs.forEach(l => {
        if (l.habitId === h.id && (l.status === 'completed_full' || l.status === 'completed_minimum') && l.date) checkins[l.date] = 1;
      });
      const cue = h.cue ? [h.cue.description, h.cue.plannedTime].filter(Boolean).join(' · ') : '';
      return { id: h.id || uid(), name: h.name || 'Habit', cue: cue || 'Any time', createdAt: h.startDate || today(), checkins };
    });
  }

  function list() {
    let l = read();
    if (l === null) { l = migrate(); write(l); }
    return l;
  }
  function get(id) { return list().find(s => s.id === id) || null; }

  function add(data) {
    const l = list();
    const s = { id: uid(), name: String(data.name || '').trim(), cue: String(data.cue || '').trim(), createdAt: today(), checkins: {} };
    l.push(s); write(l); return s;
  }
  function remove(id) { write(list().filter(s => s.id !== id)); }

  // ── The walk: replay history to derive xp + multiplier ─────────────────
  // Today only counts when checked in — an unfinished today is never a miss.
  function stats(s) {
    const tk = today();
    const dates = Object.keys(s.checkins || {});
    let start = s.createdAt || tk;
    dates.forEach(d => { if (d < start) start = d; });
    let m = 1.0, xp = 0, gap = 0, days = 0, earnedToday = 0;
    const cur = fromStr(start), end = fromStr(tk);
    for (let i = 0; i < 1500 && cur <= end; i++, cur.setDate(cur.getDate() + 1)) {
      const k = dstr(cur);
      if (s.checkins[k]) {
        const gain = Math.round(BASE_XP * m);
        xp += gain;
        if (k === tk) earnedToday = gain;
        m = Math.min(MAX_MULT, +(m + MULT_STEP).toFixed(2));
        gap = 0; days++;
      } else if (k < tk) {
        gap++;
        if (gap === 2) m = Math.max(1.0, +(m / 2).toFixed(2)); // halve once per lapse
        // gap === 1 → frozen: multiplier untouched
      }
    }
    // For an unchecked today, m is exactly the multiplier the next check-in earns.
    return { xp, mult: m, days, doneToday: !!s.checkins[tk], earnedToday: earnedToday || Math.round(BASE_XP * m) };
  }

  function levelInfo(xp) {
    let i = 0;
    while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1].at) i++;
    const cur = LEVELS[i], next = LEVELS[i + 1] || null;
    const pct = next ? Math.min(100, Math.round(((xp - cur.at) / (next.at - cur.at)) * 100)) : 100;
    return { index: i, name: cur.name, next: next ? next.name : null, pct, toNext: next ? next.at - xp : 0 };
  }

  // ── Character: sum of skill XP + perfect-day bonuses ────────────────────
  function perfectDays() {
    const l = list(); if (!l.length) return 0;
    const tk = today();
    let start = tk;
    l.forEach(s => { if (s.createdAt < start) start = s.createdAt; });
    let n = 0;
    const cur = fromStr(start), end = fromStr(tk);
    for (let i = 0; i < 1500 && cur <= end; i++, cur.setDate(cur.getDate() + 1)) {
      const k = dstr(cur);
      const existing = l.filter(s => s.createdAt <= k);
      if (existing.length && existing.every(s => s.checkins[k])) n++;
    }
    return n;
  }
  function character() {
    const skills = list().map(s => stats(s).xp);
    const perfect = perfectDays();
    const xp = skills.reduce((a, b) => a + b, 0) + perfect * PERFECT_XP;
    return {
      xp, perfect,
      level: Math.floor(xp / CHAR_LVL_XP) + 1,
      pct: Math.round((xp % CHAR_LVL_XP) / CHAR_LVL_XP * 100),
      toNext: CHAR_LVL_XP - (xp % CHAR_LVL_XP),
    };
  }

  // ── Check in / undo. Reports a level-up so the UI can say one quiet line.
  function toggle(id, date) {
    const l = list(); const s = l.find(x => x.id === id); if (!s) return null;
    const k = date || today();
    const before = levelInfo(stats(s).xp);
    if (s.checkins[k]) delete s.checkins[k]; else s.checkins[k] = 1;
    write(l);
    const st = stats(s);
    const after = levelInfo(st.xp);
    return {
      done: !!s.checkins[k],
      gained: st.earnedToday,
      leveledUp: after.index > before.index ? { name: s.name, level: after.name, days: st.days } : null,
    };
  }

  function questsToday() { return list().map(s => { const st = stats(s); return Object.assign({ skill: s }, st, levelInfo(st.xp)); }); }
  function perfectToday() { const l = list(); const tk = today(); return l.length > 0 && l.every(s => s.checkins[tk]); }

  window.Habits = { list, get, add, remove, toggle, stats, levelInfo, character, perfectDays, perfectToday, questsToday, today, LEVELS, BASE_XP, PERFECT_XP };
})();
