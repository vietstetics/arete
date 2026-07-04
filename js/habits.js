/* ============================================================================
 *  Arete Habits — a guided habit-building system (not a streak tracker).
 *
 *  Everything lives behind a small repository so it can move to a real DB later.
 *  Storage:  arete_habits (Habit[]), arete_habit_logs (HabitLog[]).
 *  Reads existing app data (jarvis_*) read-only for auto-completion.
 * ==========================================================================*/
window.Habits = (() => {
  const HKEY = 'arete_habits', LKEY = 'arete_habit_logs';

  // ── repository ───────────────────────────────────────────────────────────
  function _read(k){ try { return JSON.parse(localStorage.getItem(k)) || []; } catch { return []; } }
  function _write(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  const repo = {
    habits: () => _read(HKEY),
    saveHabits: (h) => _write(HKEY, h),
    logs: () => _read(LKEY),
    saveLogs: (l) => _write(LKEY, l),
  };

  // ── date helpers ─────────────────────────────────────────────────────────
  const pad = (n) => String(n).padStart(2, '0');
  function dstr(d){ d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()); }
  function today(){ return dstr(); }
  function fromStr(s){ const [y,m,d] = String(s).split('-').map(Number); return new Date(y, m-1, d); }
  function daysBetween(a, b){ return Math.round((fromStr(b) - fromStr(a)) / 86400000); }
  function uid(){ return 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2,6); }

  // ── the 66-day journey ───────────────────────────────────────────────────
  const STAGES = [
    { min: 1,  max: 7,  name: 'Initiation' },
    { min: 8,  max: 21, name: 'Stabilisation' },
    { min: 22, max: 42, name: 'Identity' },
    { min: 43, max: 66, name: 'Automaticity' },
    { min: 67, max: Infinity, name: 'Lifestyle' },
  ];
  function currentDay(h){ return h.startDate ? Math.max(1, daysBetween(h.startDate, today()) + 1) : 1; }
  function stageOf(day){ return (STAGES.find(s => day >= s.min && day <= s.max) || STAGES[0]).name; }

  // ── CRUD ─────────────────────────────────────────────────────────────────
  function list(){ return repo.habits(); }
  function byStatus(status){ return repo.habits().filter(h => h.status === status); }
  function get(id){ return repo.habits().find(h => h.id === id) || null; }
  function activeCount(){ return byStatus('active').length; }

  function create(data){
    const now = new Date().toISOString();
    const h = {
      id: uid(),
      name: (data.name || 'New habit').trim(),
      category: data.category || 'lifestyle',
      targetType: data.targetType || 'yes_no',
      targetValue: data.targetValue != null ? Number(data.targetValue) : undefined,
      targetUnit: data.targetUnit || undefined,
      reason: (data.reason || '').trim(),
      cue: {
        type: (data.cue && data.cue.type) || 'time',
        description: (data.cue && data.cue.description) || '',
        plannedTime: (data.cue && data.cue.plannedTime) || undefined,
      },
      minimumVersion: (data.minimumVersion || '').trim(),
      fullVersion: (data.fullVersion || data.name || '').trim(),
      status: data.status || 'active',
      startDate: today(),
      confidence: data.confidence != null ? Number(data.confidence) : undefined,   // Q7
      habitStrength: 0,
      automaticityRating: undefined,
      createdAt: now,
      updatedAt: now,
    };
    const all = repo.habits(); all.unshift(h); repo.saveHabits(all);
    return h;
  }
  function update(id, patch){
    const all = repo.habits(); const h = all.find(x => x.id === id); if (!h) return null;
    Object.assign(h, patch, { updatedAt: new Date().toISOString() });
    if (patch.cue) h.cue = Object.assign({}, h.cue, patch.cue);
    repo.saveHabits(all); return h;
  }
  function remove(id){
    repo.saveHabits(repo.habits().filter(h => h.id !== id));
    repo.saveLogs(repo.logs().filter(l => l.habitId !== id));
  }
  function setStatus(id, status){ return update(id, { status }); }

  // ── logs ─────────────────────────────────────────────────────────────────
  function logsFor(id){ return repo.logs().filter(l => l.habitId === id).sort((a,b)=>a.date<b.date?-1:1); }
  function getLog(id, date){ return repo.logs().find(l => l.habitId === id && l.date === (date||today())) || null; }
  function setLog(id, status, extra){
    const date = (extra && extra.date) || today();
    const all = repo.logs();
    let l = all.find(x => x.habitId === id && x.date === date);
    if (!l){ l = { id: 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2,5), habitId: id, date }; all.push(l); }
    l.status = status;
    if (status === 'completed_full' || status === 'completed_minimum') l.completedAt = new Date().toISOString();
    if (extra){
      if (extra.automaticityRating != null) l.automaticityRating = extra.automaticityRating;
      if (extra.difficultyRating != null)  l.difficultyRating = extra.difficultyRating;
      if (extra.energyLevel != null)       l.energyLevel = extra.energyLevel;
      if (extra.failureReason)             l.failureReason = extra.failureReason;
      if (extra.auto != null)              l.auto = extra.auto;
    }
    repo.saveLogs(all);
    // latest automaticity bubbles onto the habit + recompute strength
    if (extra && extra.automaticityRating != null) update(id, { automaticityRating: extra.automaticityRating });
    recompute(id);
    return l;
  }
  function setAutomaticity(id, rating, date){
    const l = getLog(id, date) || setLog(id, 'completed_full', { date });
    return setLog(id, l.status, { date, automaticityRating: rating });
  }

  // ── external app data (read-only) → today's measured value ───────────────
  function _num(v){ const x = parseFloat(v); return isFinite(x) ? x : 0; }
  function morningScore(){
    try { const c = JSON.parse(localStorage.getItem('jarvis_checkin')); return (c && c.date === today()) ? c.morningScore : null; } catch { return null; }
  }
  function proteinToday(){
    try {
      const log = JSON.parse(localStorage.getItem('jarvis_nutrition_log') || '{}');
      const entries = log[today()] || [];
      return entries.reduce((s,e)=> s + _num(e.protein) * (e.qty || 1), 0);
    } catch { return 0; }
  }
  function caloriesTrackedToday(){
    try { const log = JSON.parse(localStorage.getItem('jarvis_nutrition_log') || '{}'); return (log[today()] || []).length; } catch { return 0; }
  }
  function stepsToday(){
    try { const m = JSON.parse(localStorage.getItem('jarvis_steps') || '{}'); const r = m[today()]; return r ? (r.steps || 0) : 0; } catch { return 0; }
  }
  function waterToday(){
    try { const w = JSON.parse(localStorage.getItem('jarvis_water') || '{}'); return _num(w[today()]); } catch { return 0; }
  }
  function workoutDoneToday(){
    try { const w = JSON.parse(localStorage.getItem('jarvis_workouts') || '[]'); return w.some(x => x.completedAt && dstr(new Date(x.completedAt)) === today()); } catch { return false; }
  }
  function checkinDoneToday(){ return morningScore() != null; }
  function financeLoggedToday(){
    try { const f = JSON.parse(localStorage.getItem('jarvis_finance') || '[]'); return Array.isArray(f) && f.some(x => (x.date||'').slice(0,10) === today()); } catch { return false; }
  }

  // Measured progress for a habit today: { value, target, unit, pct, met, source }
  function measure(h){
    const T = h.targetType, tv = h.targetValue;
    let value = null, unit = h.targetUnit || '', source = null, target = tv;
    if (T === 'nutrition'){ value = Math.round(proteinToday()); unit = unit || 'g'; source = 'Nutrition'; }
    else if (T === 'steps'){ value = stepsToday(); unit = unit || 'steps'; source = 'Steps'; if (target == null){ try { target = _num(localStorage.getItem('jarvis_steps_goal')) || 10000; } catch { target = 10000; } } }
    else if (T === 'workout'){ value = workoutDoneToday() ? 1 : 0; target = 1; unit = ''; source = 'Training'; }
    else if (T === 'app_event'){ value = checkinDoneToday() ? 1 : 0; target = 1; unit = ''; source = 'Check-in'; }
    else if (T === 'money'){ value = null; source = 'manual'; }
    else if (T === 'number' && /water|litre|liter|l\b/i.test(unit || h.name)){ value = waterToday(); unit = unit || 'L'; source = 'Water'; }
    if (value == null){ const l = getLog(h.id); value = l && (l.status==='completed_full'||l.status==='completed_minimum') ? (target || 1) : 0; }
    const pct = target ? Math.min(100, Math.round(value / target * 100)) : (value ? 100 : 0);
    const met = target ? value >= target : value > 0;
    return { value, target, unit, pct, met, source };
  }

  // Auto-complete detectable habits for today (never downgrades a manual log).
  function autoComplete(){
    repo.habits().forEach(h => {
      if (h.status !== 'active' && h.status !== 'support') return;
      const auto =
        h.targetType === 'workout'   ? workoutDoneToday() :
        h.targetType === 'app_event' ? checkinDoneToday() :
        h.targetType === 'steps'     ? measure(h).met :
        h.targetType === 'nutrition' ? measure(h).met :
        h.targetType === 'finance' || h.targetType === 'money' ? financeLoggedToday() :
        (h.targetType === 'number' && /water/i.test((h.targetUnit||'')+h.name)) ? measure(h).met : false;
      if (auto){
        const l = getLog(h.id);
        if (!l || l.status === 'missed'){ setLog(h.id, 'completed_full', { auto: true }); }
      }
    });
  }

  // ── Habit Strength (0–100) ───────────────────────────────────────────────
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  function scores(h){
    const logs = logsFor(h.id);
    const day = currentDay(h);
    const window = Math.min(day, 30);
    // build a per-day status map for the window ending today
    const map = {}; logs.forEach(l => map[l.date] = l);
    let required = 0, cWeight = 0, recentReq = 0, recentDone = 0;
    const autoVals = [], diffVals = [];
    let misses = 0, recovered = 0, prevMissed = false;
    for (let i = window - 1; i >= 0; i--){
      const d = dstr(new Date(fromStr(today()).getTime() - i * 86400000));
      const l = map[d];
      const st = l && l.status;
      if (st === 'skipped_planned' || st === 'not_required') { prevMissed = false; continue; }
      required++;
      const w = st === 'completed_full' ? 1 : st === 'completed_minimum' ? 0.6 : 0;
      cWeight += w;
      if (i < 7){ recentReq++; if (w > 0) recentDone++; }
      if (l && l.automaticityRating != null) autoVals.push(l.automaticityRating);
      if (l && l.difficultyRating != null) diffVals.push(l.difficultyRating);
      if (w === 0){ misses++; prevMissed = true; }
      else { if (prevMissed) recovered++; prevMissed = false; }
    }
    const consistencyScore = required ? cWeight / required : 0;
    const cueScore = recentReq ? recentDone / recentReq : consistencyScore;               // recent rhythm
    const autoAvg = autoVals.length ? autoVals.reduce((a,b)=>a+b,0)/autoVals.length : (h.automaticityRating || 3);
    const automaticityScore = clamp01(autoAvg / 10);
    const diffAvg = diffVals.length ? diffVals.reduce((a,b)=>a+b,0)/diffVals.length : 5;   // 5 ≈ ideal
    const difficultyScore = clamp01(1 - Math.abs(diffAvg - 5) / 5);
    const recoveryScore = misses ? clamp01(recovered / misses) : 1;
    return { consistencyScore, cueScore, automaticityScore, difficultyScore, recoveryScore };
  }
  function strength(h){
    const s = scores(h);
    return Math.round(100 * (
      s.consistencyScore * 0.40 +
      s.cueScore         * 0.20 +
      s.automaticityScore* 0.20 +
      s.difficultyScore  * 0.10 +
      s.recoveryScore    * 0.10
    ));
  }
  function strengthLabel(v){ return v >= 80 ? 'Strong' : v >= 60 ? 'Stable' : v >= 40 ? 'Building' : 'Fragile'; }
  function recompute(id){ const h = get(id); if (h){ update(id, { habitStrength: strength(h) }); } }
  function recomputeAll(){ repo.habits().forEach(h => update(h.id, { habitStrength: strength(h) })); }

  // ── Recommendation: full vs minimum (uses Morning Score) ─────────────────
  function recommendedVersion(h){
    const ms = morningScore();
    const str = h.habitStrength || 0;
    if (ms != null && ms < 50) return 'minimum';
    if (ms != null && ms >= 70) return 'full';
    if (str < 40) return 'minimum';           // fragile habits: protect with the minimum
    return 'full';
  }

  // ── Missed-day recovery ──────────────────────────────────────────────────
  function lastMissedOpen(h){
    // a required past day with no completion and no recorded reason yet
    const logs = {}; logsFor(h.id).forEach(l => logs[l.date] = l);
    const day = currentDay(h);
    for (let i = 1; i <= Math.min(day-1, 7); i++){
      const d = dstr(new Date(fromStr(today()).getTime() - i * 86400000));
      const l = logs[d];
      const done = l && (l.status === 'completed_full' || l.status === 'completed_minimum' || l.status === 'skipped_planned');
      if (!done && !(l && l.failureReason)) return d;   // an unexplained miss
    }
    return null;
  }
  const RECOVERY = {
    too_hard:      'Make the minimum version smaller so it’s easy to protect on any day.',
    forgot:        'Move the cue to right after something you already do every day.',
    too_tired:     'On low-energy days, do the minimum version — it still counts.',
    too_busy:      'Shrink it or attach it to a fixed time so it fits a packed day.',
    bad_timing:    'Try a different planned time — pick a slot you rarely miss.',
    low_motivation:'Reconnect to your reason, then just do the minimum today.',
    other:         'Do the minimum version today — protecting the habit beats perfection.',
  };
  function recordMiss(id, date, reason){
    setLog(id, 'missed', { date, failureReason: reason });
    return RECOVERY[reason] || RECOVERY.other;
  }

  // ── Automaticity prompt cadence (every ~4 days) ──────────────────────────
  function needsAutomaticity(h){
    if (currentDay(h) < 3) return false;
    const logs = logsFor(h.id).filter(l => l.automaticityRating != null);
    if (!logs.length) return true;
    const last = logs[logs.length-1];
    return daysBetween(last.date, today()) >= 4;
  }

  // ── Public view model for the dashboard ──────────────────────────────────
  function summary(h){
    const day = currentDay(h);
    const m = measure(h);
    const todayLog = getLog(h.id);
    const doneToday = todayLog && (todayLog.status === 'completed_full' || todayLog.status === 'completed_minimum');
    return {
      id: h.id, name: h.name, category: h.category, status: h.status,
      day, stage: stageOf(day), progressDay: Math.min(100, Math.round(day/66*100)),
      strength: h.habitStrength || 0, strengthLabel: strengthLabel(h.habitStrength || 0),
      measure: m, recommended: recommendedVersion(h),
      cue: h.cue, minimumVersion: h.minimumVersion, fullVersion: h.fullVersion, reason: h.reason,
      targetType: h.targetType, targetValue: h.targetValue, targetUnit: h.targetUnit,
      todayStatus: todayLog ? todayLog.status : null, doneToday,
      needsAutomaticity: needsAutomaticity(h), missedOpen: lastMissedOpen(h),
    };
  }

  // Run detection/auto-complete + refresh strength. Call on page load.
  function refresh(){ autoComplete(); recomputeAll(); }

  return {
    // data
    list, byStatus, get, create, update, remove, setStatus, activeCount,
    // logs
    getLog, setLog, setAutomaticity, logsFor,
    // scoring
    scores, strength, strengthLabel, recompute, recomputeAll,
    // journey
    currentDay, stageOf, STAGES,
    // recommendation + measure + auto
    recommendedVersion, measure, autoComplete, morningScore, refresh,
    // recovery
    lastMissedOpen, recordMiss, RECOVERY, needsAutomaticity,
    // view
    summary,
    // meta
    CATEGORIES: ['fitness','nutrition','sleep','productivity','study','finance','mindset','lifestyle'],
    TARGET_TYPES: ['yes_no','number','time','steps','nutrition','workout','money','app_event'],
    MAX_ACTIVE: 3,
  };
})();
