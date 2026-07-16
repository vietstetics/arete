// Cloud provider adapters.
//
// Oura / WHOOP / Fitbit bridge the EXISTING working integrations in
// js/wearables.js (Oura personal token via the api/oura.js pass-through;
// WHOOP and Fitbit OAuth once their app credentials are configured). They are
// managed on the Connections page; here they surface with honest status.
//
// Garmin / Polar / Withings / Samsung Health are Phase 3: shown as
// “Coming soon” and NEVER pretended to be connected. Each needs provider
// developer access + OAuth config through a secure backend (see
// api/integrations/README.md).

function wearables() { return typeof window !== 'undefined' ? window.Wearables : null; }

function bridgeAdapter(providerId, wearablesId, info) {
  return {
    provider: providerId,
    info,
    async isAvailable() {
      const W = wearables();
      return !!(W && W.availableProvider && W.availableProvider(wearablesId));
    },
    async connect() {
      throw new Error(info.name + ' connects from the Connections page — tap “Open Connections”.');
    },
    async disconnect() {
      const W = wearables();
      if (W) W.setConnected(wearablesId, false);
    },
    async getConnectionStatus() {
      const W = wearables();
      const connected = !!(W && W.getConnections && W.getConnections()[wearablesId]);
      const available = !!(W && W.availableProvider && W.availableProvider(wearablesId));
      return {
        provider: providerId,
        state: connected ? 'connected' : available ? 'disconnected' : 'unavailable',
        permissionState: connected ? 'granted' : 'not_requested',
      };
    },
    async getCapabilities() { return info.capabilities; },
    async sync() {
      const W = wearables();
      if (!W) return { provider: providerId, ok: false, imported: 0, duplicates: 0, error: 'Not available', syncedAt: new Date().toISOString() };
      try {
        await W.latestStats(wearablesId); // feeds the readiness merge directly
        return { provider: providerId, ok: true, imported: 0, duplicates: 0, syncedAt: new Date().toISOString() };
      } catch (e) {
        return { provider: providerId, ok: false, imported: 0, duplicates: 0, error: 'Sync failed', syncedAt: new Date().toISOString() };
      }
    },
  };
}

function comingSoonAdapter(providerId, info) {
  return {
    provider: providerId,
    info,
    comingSoon: true,
    async isAvailable() { return false; },
    async connect() { throw new Error(info.name + ' isn’t available yet — it needs provider developer approval and a secure backend (Phase 3).'); },
    async disconnect() {},
    async getConnectionStatus() { return { provider: providerId, state: 'unavailable', permissionState: 'not_requested' }; },
    async getCapabilities() { return info.capabilities; },
    async sync() { return { provider: providerId, ok: false, imported: 0, duplicates: 0, error: 'Coming soon', syncedAt: new Date().toISOString() }; },
  };
}

export const ouraAdapter = bridgeAdapter('oura', 'oura', {
  name: 'Oura', viaConnections: true,
  description: 'Readiness, sleep, HRV and resting heart rate from your Oura Ring — connects with your personal token.',
  capabilities: ['sleep', 'hrv', 'resting_heart_rate', 'steps'],
});
export const whoopAdapter = bridgeAdapter('whoop', 'whoop', {
  name: 'WHOOP', viaConnections: true,
  description: 'Recovery, strain and sleep from WHOOP. Requires the WHOOP app credentials to be configured.',
  capabilities: ['sleep', 'hrv', 'resting_heart_rate'],
});
export const fitbitAdapter = bridgeAdapter('fitbit', 'fitbit', {
  name: 'Fitbit', viaConnections: true,
  description: 'Steps, sleep and heart data from Fitbit. Requires the Fitbit app credentials to be configured.',
  capabilities: ['steps', 'sleep', 'resting_heart_rate', 'hrv'],
});

export const garminAdapter = comingSoonAdapter('garmin', {
  name: 'Garmin',
  description: 'Coming soon — Garmin’s API is partner-gated. Until then, sync Garmin through Apple Health or Health Connect.',
  capabilities: ['steps', 'sleep', 'workout', 'heart_rate'],
});
export const polarAdapter = comingSoonAdapter('polar', {
  name: 'Polar',
  description: 'Coming soon — needs Polar AccessLink OAuth through a secure backend.',
  capabilities: ['workout', 'heart_rate', 'sleep'],
});
export const withingsAdapter = comingSoonAdapter('withings', {
  name: 'Withings',
  description: 'Coming soon — needs Withings OAuth through a secure backend. Until then, sync scales via Apple Health / Health Connect.',
  capabilities: ['weight', 'body_fat', 'sleep', 'heart_rate'],
});
export const samsungHealthAdapter = comingSoonAdapter('samsung_health', {
  name: 'Samsung Health',
  description: 'Coming soon as a direct integration — today Samsung Health data arrives via Health Connect on Android.',
  capabilities: ['steps', 'sleep', 'workout', 'heart_rate'],
});
