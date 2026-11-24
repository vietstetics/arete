/* ============================================================================
 *  Set history → the account database (Supabase tables exercise_sets and velocity_sets,
 *  supabase/schema.sql). One row per logged set and per camera-tracked set, so weight
 *  progression and bar-speed history are kept as organised rows, whatever the size of the
 *  whole-account copy.
 *
 *  It compares what is on the phone with what has been sent (a fingerprint per workout and per
 *  camera record) and uploads whatever is new or changed, so edits made anywhere are caught. Rows
 *  are only ever removed for a workout the user deleted (a delete marker written by
 *  js/fitness.js); a workout or record missing from the phone never deletes anything.
 * ==========================================================================*/
(function () {
  if (window.SetSync) return;

  var SENT_KEY = 'arete_sets_sent', TOMB_KEY = 'arete_sets_deleted', STATUS_KEY = 'arete_sets_status';
  var WORKOUTS_KEY = 'jarvis_workouts', RECORDS_KEY = 'arete_velocity_sets';

  function read(k, fb) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? fb : v; } catch (e) { return fb; } }
  function write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* full: retried next time */ } }

  // ── Row builders (pure) ──
  function key(name) { return typeof name === 'string' && name.trim() ? name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase() : null; }
  function text(v, max) { return typeof v === 'string' && v ? v.slice(0, max) : null; }
  function num(v, lo, hi, dp) {
    if (v === '' || v == null) return null;
    var n = +v; if (!isFinite(n) || n < lo || n >= hi) return null;
    var f = Math.pow(10, dp); return Math.round(n * f) / f;
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function localDate(ms) { var d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function iso(ms) { return isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null; }

  // Fastest of the first three counted reps with a clean speed, m/s only (as features/velocity/services/readiness.js).
  function cleanSpeeds(rec) {
    if (!rec || rec.units !== 'm/s' || !Array.isArray(rec.reps)) return [];
    return rec.reps.filter(function (r) { return r && r.result === 'counted' && r.velocity === 'ok' && isFinite(r.mcv) && r.mcv > 0; }).map(function (r) { return r.mcv; });
  }
  function velocityRow(rec, ctx) {
    if (!rec || typeof rec.id !== 'string' || !rec.id) return null;
    var name = text(rec.exercise, 160) || text(ctx.exercise, 160) || 'Camera set';
    var v = cleanSpeeds(rec);
    var row = {
      record_id: rec.id.slice(0, 160), exercise: name, exercise_key: key(name),
      equipment_key: text(rec.equipmentKey || ctx.equipmentKey, 200),
      load_kg: num(isFinite(rec.loadKg) ? rec.loadKg : ctx.loadKg, 0, 2000, 2),
      units: rec.units === 'm/s' ? 'm/s' : 'relative',
      captured_at: iso(rec.at) || iso(ctx.at) || new Date().toISOString(),
      counted: Number.isInteger(rec.counted) && rec.counted >= 0 && rec.counted < 1000 ? rec.counted : 0,
      first_mcv: v.length ? num(Math.max.apply(null, v.slice(0, 3)), 0, 20, 3) : null,
      best_mcv: v.length ? num(Math.max.apply(null, v), 0, 20, 3) : null,
      loss_pct: num(rec.lossPct, -999, 1000, 2),
      quality_ok: rec.quality && typeof rec.quality.accepted === 'boolean' ? rec.quality.accepted : null,
      reps: (rec.reps || []).slice(0, 100).map(function (r) {
        return { n: r.n, result: r.result, velocity: r.velocity || null, mcv: num(r.mcv, 0, 20, 3), rel: num(r.rel, 0, 20, 3), peak: num(r.peak, 0, 50, 3) };
      }),
    };
    if (ctx.setId) { row.set_id = ctx.setId.slice(0, 120); row.workout_id = ctx.workoutId.slice(0, 120); }
    return row;
  }
  /** A finished workout as rows: { sets: [...], velocity: [...] }. */
  function rowsForWorkout(w) {
    var out = { sets: [], velocity: [] };
    if (!w || !w.id || !w.completedAt) return out;
    var wid = String(w.id).slice(0, 120);
    var day = /^\d{4}-\d{2}-\d{2}$/.test(w.date || '') ? w.date : localDate(w.completedAt);
    (w.exercises || []).forEach(function (e, ei) {
      var name = text(e && e.name, 160); if (!name) return;
      var machine = e.machine && (e.machine.snapshot || e.machine);
      (e.sets || []).forEach(function (s, si) {
        if (!s || !s.completed) return;
        var sid = (typeof s.id === 'string' && s.id ? s.id : wid + ':' + ei + ':' + si).slice(0, 120);
        var row = {
          set_id: sid, workout_id: wid, plan_id: text(w.planId, 120), routine_id: text(w.routineId, 120),
          exercise: name, exercise_key: key(name), machine_id: text(machine && machine.id, 160),
          position: Math.min(1000, ei * 50 + si), set_type: s.type === 'warmup' ? 'warmup' : 'working',
          performed_on: day, completed_at: iso(s.completedAt) || iso(w.completedAt),
          weight_kg: num(s.weight, 0, 2000, 2), reps: num(s.reps, 0, 1000, 1), rir: num(s.rir, 0, 10.01, 1),
          weight_r: null, reps_r: null, weight_l: null, reps_l: null,
        };
        if (e.unilateral) {
          row.weight_r = num(s.weightR, 0, 2000, 2); row.reps_r = num(s.repsR, 0, 1000, 1);
          row.weight_l = num(s.weightL, 0, 2000, 2); row.reps_l = num(s.repsL, 0, 1000, 1);
        }
        out.sets.push(row);
        if (s.velocity) {
          var vr = velocityRow(s.velocity, { exercise: name, setId: sid, workoutId: wid, loadKg: s.weight, at: s.completedAt || w.completedAt });
          if (vr) out.velocity.push(vr);
        }
      });
    });
    return out;
  }
  function fingerprint(obj) {
    var s = JSON.stringify(obj), h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36) + ':' + s.length;
  }
  function realWorkouts() {
    var list = read(WORKOUTS_KEY, null);
    if (!Array.isArray(list)) return null;
    return list.filter(function (w) { return w && w.id && w.completedAt && w.status !== 'planned' && String(w.id).indexOf('mock-') !== 0; });
  }

  // ── Upload ──
  var running = false, again = false, timer = null;
  function schedule(ms) { clearTimeout(timer); timer = setTimeout(sync, ms == null ? 1500 : ms); }
  function chunk(a, n) { var out = []; for (var i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; }
  function quoteList(ids) { return '(' + ids.map(function (i) { return '"' + String(i).replace(/"/g, '') + '"'; }).join(',') + ')'; }
  function missingTable(err) { return err && (err.code === '42P01' || err.code === 'PGRST205' || /does not exist|schema cache/i.test(err.message || '')); }

  async function sync() {
    if (running) { again = true; return 'busy'; }
    var A = window.Auth;
    if (!A || !A.isConfigured() || !A.isPulled || !A.isPulled()) return 'waiting';
    var workouts = realWorkouts(); if (!workouts) return 'waiting';
    running = true; again = false;
    var result = 'ok';
    try {
      var c = await A.getClient(), u = await A.getUser(); if (!u) return 'waiting';
      var sent = read(SENT_KEY, {}); sent.w = sent.w || {}; sent.r = sent.r || {};
      var fail = function (err) { throw err; };

      // Deleted workouts: remove their rows.
      var tomb = read(TOMB_KEY, []);
      for (var t = 0; t < tomb.length; t++) {
        var id = tomb[t];
        var d1 = await c.from('exercise_sets').delete().eq('user_id', u.id).eq('workout_id', id); if (d1.error) fail(d1.error);
        var d2 = await c.from('velocity_sets').delete().eq('user_id', u.id).eq('workout_id', id); if (d2.error) fail(d2.error);
        delete sent.w[id];
        var left = read(TOMB_KEY, []).filter(function (x) { return x !== id; }); write(TOMB_KEY, left);
        write(SENT_KEY, sent);
      }

      // New or changed workouts.
      var linked = {};
      var changed = [];
      workouts.forEach(function (w) {
        var rows = rowsForWorkout(w);
        rows.velocity.forEach(function (v) { linked[v.record_id] = 1; });
        var fp = fingerprint(rows);
        if (sent.w[w.id] !== fp) changed.push({ id: String(w.id), rows: rows, fp: fp, edited: !!sent.w[w.id] });
      });
      for (var bi = 0, batches = chunk(changed, 20); bi < batches.length; bi++) {
        var batch = batches[bi];
        var setRows = [], velRows = [];
        batch.forEach(function (x) {
          x.rows.sets.forEach(function (r) { r.user_id = u.id; setRows.push(r); });
          x.rows.velocity.forEach(function (r) { r.user_id = u.id; velRows.push(r); });
        });
        for (var i = 0, sc = chunk(setRows, 400); i < sc.length; i++) { var r1 = await c.from('exercise_sets').upsert(sc[i], { onConflict: 'user_id,set_id' }); if (r1.error) fail(r1.error); }
        for (var j = 0, vc = chunk(velRows, 200); j < vc.length; j++) { var r2 = await c.from('velocity_sets').upsert(vc[j], { onConflict: 'user_id,record_id' }); if (r2.error) fail(r2.error); }
        // An edited workout: drop rows for sets or camera takes it no longer has.
        for (var k = 0; k < batch.length; k++) {
          var x = batch[k]; if (!x.edited) continue;
          var q1 = c.from('exercise_sets').delete().eq('user_id', u.id).eq('workout_id', x.id);
          if (x.rows.sets.length) q1 = q1.not('set_id', 'in', quoteList(x.rows.sets.map(function (r) { return r.set_id; })));
          var p1 = await q1; if (p1.error) fail(p1.error);
          var q2 = c.from('velocity_sets').delete().eq('user_id', u.id).eq('workout_id', x.id);
          if (x.rows.velocity.length) q2 = q2.not('record_id', 'in', quoteList(x.rows.velocity.map(function (r) { return r.record_id; })));
          var p2 = await q2; if (p2.error) fail(p2.error);
        }
        batch.forEach(function (x) { sent.w[x.id] = x.fp; });
        write(SENT_KEY, sent);
      }

      // Camera sets saved outside a workout (or before being attached to one).
      var records = read(RECORDS_KEY, []);
      var solo = [];
      (Array.isArray(records) ? records : []).forEach(function (rec) {
        if (!rec || !rec.id || linked[rec.id]) return;
        var row = velocityRow(rec, {}); if (!row) return;
        var fp = fingerprint(row);
        if (sent.r[rec.id] !== fp) solo.push({ id: rec.id, row: row, fp: fp });
      });
      for (var si = 0, sb = chunk(solo, 200); si < sb.length; si++) {
        var rows = sb[si].map(function (x) { x.row.user_id = u.id; return x.row; });
        var r3 = await c.from('velocity_sets').upsert(rows, { onConflict: 'user_id,record_id' }); if (r3.error) fail(r3.error);
        sb[si].forEach(function (x) { sent.r[x.id] = x.fp; });
        write(SENT_KEY, sent);
      }
      write(STATUS_KEY, { ok: true, at: Date.now() });
    } catch (err) {
      result = missingTable(err) ? 'needs-schema' : 'retry';
      write(STATUS_KEY, { ok: false, reason: result, at: Date.now() });
    } finally {
      running = false;
      if (again) schedule(0); else if (result === 'retry') schedule(30000);
    }
    return result;
  }

  /** Called by js/fitness.js when a finished workout is deleted. */
  function deleted(id) {
    if (!id || String(id).indexOf('mock-') === 0) return;
    var t = read(TOMB_KEY, []); if (t.indexOf(id) < 0) { t.push(String(id)); write(TOMB_KEY, t); }
    schedule();
  }

  function start() {
    schedule(0);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') sync(); });
    window.addEventListener('online', function () { schedule(0); });
  }

  window.SetSync = { rowsForWorkout: rowsForWorkout, velocityRow: velocityRow, fingerprint: fingerprint, sync: sync, schedule: schedule, deleted: deleted, start: start,
    status: function () { return read(STATUS_KEY, null); }, KEYS: { SENT_KEY: SENT_KEY, TOMB_KEY: TOMB_KEY, STATUS_KEY: STATUS_KEY } };
})();
