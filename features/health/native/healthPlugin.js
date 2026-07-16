// Registers the custom Capacitor `HealthPlugin` (implemented natively in
// native/ios/HealthPlugin.swift + native/android/HealthPlugin.kt).
// Returns null on the plain web — callers must treat the platform as
// unavailable, never fake data. Contract: features/health/types/health.ts.

export function getHealthPlugin() {
  const cap = typeof window !== 'undefined' ? window.Capacitor : undefined;
  if (!cap || typeof cap.registerPlugin !== 'function') return null;
  const isNative = typeof cap.isNativePlatform === 'function' ? cap.isNativePlatform() : false;
  if (!isNative) return null;
  try {
    return cap.registerPlugin('HealthPlugin');
  } catch {
    return null;
  }
}

/** 'ios' | 'android' | 'web' */
export function platform() {
  const cap = typeof window !== 'undefined' ? window.Capacitor : undefined;
  return cap && typeof cap.getPlatform === 'function' ? cap.getPlatform() : 'web';
}
