// Android Health Connect adapter — read-only, backed by the custom
// HealthPlugin (native/android/HealthPlugin.kt). Only exists on Android.
// Uses Health Connect, NOT the deprecated Google Fit API.
import { createNativeAdapter } from './nativeAdapter.js';

export const healthConnectAdapter = createNativeAdapter('health_connect', 'android', {
  name: 'Health Connect',
  description: 'Android’s health hub — data from Samsung Health, Fitbit, Garmin and any app that syncs to it.',
});
