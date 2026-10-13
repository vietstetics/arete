/* ============================================================================
 *  Consistency — loads Arete's commit history from the public GitHub API and
 *  turns it into per-day counts and streak stats. Shared by the dashboard
 *  widget (index.html) and the full page (consistency.html).
 *  No token needed (60 requests/hour per IP); results are cached for an hour
 *  in localStorage, and the last good copy is reused when offline.
 * ==========================================================================*/
(function () {
  if (window.Consistency) return;

  var REPO = 'vietstetics/arete';
  var CACHE_KEY = 'arete-consistency-v1';
  var CACHE_MS = 60 * 60 * 1000;

  function pad(n) { return String(n).padStart(2, '0'); }
  function keyOf(dt) { return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate()); }
  function dayDiff(a, b) { return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5); }

  async function fetchCommits() {
    var all = [];
    for (var page = 1; page <= 10; page++) {
      var res = await fetch('https://api.github.com/repos/' + REPO + '/commits?per_page=100&page=' + page,
        { headers: { Accept: 'application/vnd.github+json' } });
      if (!res.ok) throw new Error(res.status === 403 ? 'GitHub rate limit reached. Try again in an hour.' : 'GitHub returned ' + res.status + '.');
      var batch = await res.json();
      batch.forEach(function (c) {
        if (c.parents && c.parents.length > 1) return;   // skip merge commits
        all.push({ d: c.commit.author.date, m: c.commit.message.split('\n')[0] });
      });
      if (batch.length < 100) break;
    }
    return all;
  }

  // 'YYYY-MM-DD' (local time) -> { c: count, m: [first lines of messages] }
  function group(commits) {
    var out = {};
    commits.forEach(function (c) {
      var k = keyOf(new Date(c.d));
      if (!out[k]) out[k] = { c: 0, m: [] };
      out[k].c++; out[k].m.push(c.m);
    });
    return out;
  }

  function readCache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch (e) { return null; } }

  // Calls onData(days, fetchedAt) with cached data right away when there is
  // some, then again with fresh data. Resolves to { error } on failure.
  async function load(onData, force) {
    var cached = readCache();
    if (cached) onData(group(cached.commits), cached.t);
    if (cached && !force && Date.now() - cached.t < CACHE_MS) return {};
    try {
      var commits = await fetchCommits(), t = Date.now();
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ t: t, commits: commits })); } catch (e) {}
      onData(group(commits), t);
      return {};
    } catch (err) {
      return { error: err.message, hadCache: !!cached };
    }
  }

  function stats(days) {
    var today = keyOf(new Date());
    var keys = Object.keys(days).sort();
    var longest = 0, run = 0, prev = null;
    keys.forEach(function (k) { run = prev && dayDiff(prev, k) === 1 ? run + 1 : 1; longest = Math.max(longest, run); prev = k; });
    // Current streak counts back from today, or from yesterday if nothing is committed yet today.
    var cur = 0, d = new Date(today + 'T12:00:00');
    if (!days[today]) d.setDate(d.getDate() - 1);
    while (days[keyOf(d)]) { cur++; d.setDate(d.getDate() - 1); }
    var last = keys[keys.length - 1] || null;
    return {
      today: today,
      current: cur,
      longest: longest,
      last: last,
      sinceLast: last ? dayDiff(last, today) : null,
      activeDays: keys.length,
      perWeek: keys.length ? keys.length / ((dayDiff(keys[0], today) + 1) / 7) : 0,
    };
  }

  // Quartiles of active days, so the four shades spread evenly however busy you are.
  function thresholds(days) {
    var v = Object.keys(days).map(function (k) { return days[k].c; }).sort(function (a, b) { return a - b; });
    if (!v.length) return [1, 2, 3];
    var q = function (p) { return v[Math.min(v.length - 1, Math.floor(p * v.length))]; };
    return [q(.25), q(.5), q(.75)];
  }
  function level(n, t) { return !n ? 0 : n <= t[0] ? 1 : n <= t[1] ? 2 : n <= t[2] ? 3 : 4; }

  function sinceLabel(n) { return n === null ? '–' : n === 0 ? 'Today' : n === 1 ? 'Yesterday' : n + 'd ago'; }

  window.Consistency = {
    REPO: REPO, load: load, stats: stats, thresholds: thresholds, level: level,
    keyOf: keyOf, dayDiff: dayDiff, pad: pad, sinceLabel: sinceLabel,
  };
})();
