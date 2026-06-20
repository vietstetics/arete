// Timezone-safe LOCAL date helpers. Steps are bucketed by the device's local
// calendar day (local midnight), so we never use UTC for date keys — that
// keeps "today" correct across timezone changes and DST.

/** Local YYYY-MM-DD for a Date (default: now). */
export function localDateString(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Today's local date key. */
export function todayKey() {
  return localDateString();
}

/** Local midnight (start of day) for a Date. */
export function startOfLocalDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Date object at local midnight for a YYYY-MM-DD string. */
export function dateFromKey(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/** Shift a YYYY-MM-DD key by n days (n may be negative). */
export function addDays(dateStr, n) {
  const dt = dateFromKey(dateStr);
  dt.setDate(dt.getDate() + n);
  return localDateString(dt);
}

/** Inclusive list of YYYY-MM-DD keys from start..end (ascending). */
export function rangeDates(startDate, endDate) {
  const out = [];
  let cur = startDate;
  let guard = 0;
  while (cur <= endDate && guard < 4000) {
    out.push(cur);
    cur = addDays(cur, 1);
    guard++;
  }
  return out;
}

/** First day of the current local month as a YYYY-MM-DD key. */
export function startOfMonthKey(d = new Date()) {
  return localDateString(new Date(d.getFullYear(), d.getMonth(), 1));
}
