// Apple Health (HealthKit) adapter — read-only, backed by the custom
// HealthPlugin (native/ios/HealthPlugin.swift). Only exists on iOS.
import { createNativeAdapter } from './nativeAdapter.js';

export const appleHealthAdapter = createNativeAdapter('apple_health', 'ios', {
  name: 'Apple Health',
  description: 'Steps, sleep, workouts, heart data and body metrics from your iPhone and Apple Watch.',
});
