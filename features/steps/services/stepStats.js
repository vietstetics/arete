// Pure stat computations for the dashboard card and history view.
// Input: an array of DailySteps records (any order) + goal + today's key.
// No DOM, no storage — fully unit-testable.

import { addDays, startOfMonthKey, localDateString } from '../util/date.js';

function toMap(records) {
  const m = {};
  for (const r of records || []) m[r.date] = r.steps || 0;
  return m;
}

/** Average steps over the last 7 calendar days ending `today` (missing = 0). */
export function sevenDayAverage(records, today) {
  const map = toMap(records);
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += map[addDays(today, -i)] || 0;
  return Math.round(sum / 7);
}

/**
 * Current goal streak: consecutive days meeting `goal`, counting back from
 * today. Today not yet meeting the goal does NOT break a prior streak — we
 * start counting from yesterday in that case (forgiving mid-day behaviour).
 */
export function currentStreak(records, goal, today) {
  const map = toMap(records);
  let streak = 0;
  let start = today;
  if ((map[today] || 0) < goal) start = addDays(today, -1); // today still in progress
  let cursor = start;
  let guard = 0;
  while (guard < 4000) {
    if ((map[cursor] || 0) >= goal) {
      streak++;
      cursor = addDays(cursor, -1);
    } else break;
    guard++;
  }
  return streak;
}

/** Stats for the dashboard card. */
export function dashboardStats(records, goal, today) {
  const map = toMap(records);
  const todaySteps = map[today] || 0;
  const percent = goal > 0 ? Math.min(100, Math.round((todaySteps / goal) * 100)) : 0;
  const remaining = Math.max(0, goal - todaySteps);
  return {
    today: todaySteps,
    goal,
    percent,
    remaining,
    sevenDayAverage: sevenDayAverage(records, today),
    streak: currentStreak(records, goal, today),
  };
}

/** Stats for the history view. */
export function historyStats(records, goal, today) {
  const all = (records || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  const monthStart = startOfMonthKey(new Date(today.replace(/-/g, '/')));

  let monthlyTotal = 0;
  let goalCompletionDays = 0;
  let best = { date: null, steps: 0 };
  for (const r of all) {
    if (r.date >= monthStart && r.date <= today) monthlyTotal += r.steps || 0;
    if ((r.steps || 0) >= goal) goalCompletionDays++;
    if ((r.steps || 0) > best.steps) best = { date: r.date, steps: r.steps };
  }

  // 7-day series (oldest..today) for the graph, missing days = 0.
  const map = toMap(all);
  const series = [];
  for (let i = 6; i >= 0; i--) {
    const date = addDays(today, -i);
    series.push({ date, steps: map[date] || 0, metGoal: (map[date] || 0) >= goal });
  }

  return {
    series,
    weeklyAverage: sevenDayAverage(all, today),
    monthlyTotal,
    bestDay: best,
    goalCompletionDays, // all-time count of days that met goal
  };
}

export { localDateString };
