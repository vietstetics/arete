// One preferred source per metric — totals are NEVER summed across providers.
// 'auto' picks the single best-available source by a fixed priority order;
// 'arete' means the user's own in-app logging wins.

import { healthRepository } from '../repositories/healthRepository.js';

export const METRICS = [
  { key: 'steps',           label: 'Steps' },
  { key: 'sleep',           label: 'Sleep' },
  { key: 'workouts',        label: 'Workouts' },
  { key: 'recovery',        label: 'Recovery (RHR + HRV)' },
  { key: 'weight',          label: 'Weight & body fat' },
  { key: 'active_calories', label: 'Active calories' },
];

// Fixed priority for 'auto' (first connected provider wins for the metric).
const AUTO_PRIORITY = {
  steps:           ['apple_health', 'health_connect', 'fitbit', 'oura'],
  sleep:           ['oura', 'whoop', 'apple_health', 'health_connect', 'fitbit'],
  workouts:        ['apple_health', 'health_connect'],
  recovery:        ['whoop', 'oura', 'apple_health', 'health_connect', 'fitbit'],
  weight:          ['withings', 'apple_health', 'health_connect'],
  active_calories: ['apple_health', 'health_connect', 'fitbit'],
};

export function getPreferences(repo) {
  return (repo || healthRepository).getPreferences();
}
export function setPreference(metric, source, repo) {
  (repo || healthRepository).setPreference(metric, source);
}

/**
 * Resolve which provider actually feeds a metric right now.
 * Returns a HealthProviderId, 'arete', or null (nothing connected).
 */
export function resolveSource(metric, connectedProviders, repo) {
  const pref = getPreferences(repo)[metric];
  if (pref === 'arete') return 'arete';
  if (pref && pref !== 'auto') {
    return connectedProviders.includes(pref) ? pref : null;
  }
  const order = AUTO_PRIORITY[metric] || [];
  for (const p of order) if (connectedProviders.includes(p)) return p;
  return null;
}
