// Bodyweight: one weigh-in per day, the trend through them, and how fast it's moving. Pure logic.
//
// A single weigh-in swings 1–2 kg with water, food and salt, so decisions use the TREND: an
// exponentially smoothed average that moves 10% of the way to each new weigh-in (the Hacker's Diet
// method; about as steady as a 20-day moving average). Days without a weigh-in are gaps, not zeros:
// the step to the next weigh-in is 1 − 0.9^(days since the last one), so a weigh-in after a week away
// counts as much as a week of daily ones would have.

export const SMOOTHING = 0.1;
const DAY = 864e5;
const dayNum = (d) => Math.round(Date.parse(d + 'T00:00:00Z') / DAY);

/**
 * One weight per day from the lifter's own weigh-ins and the ones imported from a health app
 * (jarvis_body_log rows { date, weightKg, source }). The lifter's own entry wins on a day with both;
 * otherwise the day's last imported reading. → [{ date, kg, source }] oldest first.
 */
export function dailyWeights(manual = [], imported = []) {
  const byDay = new Map();
  for (const r of imported || []) {
    const kg = Number(r?.weightKg);
    if (!r?.date || !(kg > 20 && kg < 400)) continue;
    byDay.set(String(r.date).slice(0, 10), { date: String(r.date).slice(0, 10), kg, source: r.source || 'health' });
  }
  for (const r of manual || []) {
    const kg = Number(r?.kg);
    if (!r?.date || !(kg > 20 && kg < 400)) continue;
    byDay.set(String(r.date).slice(0, 10), { date: String(r.date).slice(0, 10), kg, source: 'you' });
  }
  return [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** The trend at each weigh-in: [{ date, kg, trend }]. */
export function trendSeries(daily, alpha = SMOOTHING) {
  const out = [];
  let trend = null, prevDay = null;
  for (const d of daily) {
    const day = dayNum(d.date);
    if (trend == null) trend = d.kg;
    else {
      const gap = Math.max(1, day - prevDay);
      trend += (1 - Math.pow(1 - alpha, gap)) * (d.kg - trend);
    }
    prevDay = day;
    out.push({ ...d, trend });
  }
  return out;
}

/**
 * How fast the trend is moving: kg per week over the last `days` (default 14), from the trend at the
 * newest weigh-in and at the weigh-in closest to `days` before it. Needs 4+ weigh-ins over 7+ days.
 * → { kgPerWeek, pctPerWeek, days, from, to } or null.
 */
export function weeklyRate(series, days = 14) {
  if (!series || series.length < 4) return null;
  const last = series[series.length - 1], lastDay = dayNum(last.date);
  let first = series[0];
  for (const s of series) if (lastDay - dayNum(s.date) >= days) first = s; else break;
  const span = lastDay - dayNum(first.date);
  if (span < 7) return null;
  const kgPerWeek = ((last.trend - first.trend) / span) * 7;
  return { kgPerWeek, pctPerWeek: (kgPerWeek / last.trend) * 100, days: span, from: first.date, to: last.date };
}
