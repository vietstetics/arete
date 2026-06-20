// Registers the custom Capacitor `StepCounter` plugin (implemented natively in
// native/ios + native/android). Returns null on the plain web (no native
// platform), so callers fall back to manual entry.

export function getStepCounterPlugin() {
  const cap = typeof window !== 'undefined' ? window.Capacitor : undefined;
  if (!cap || typeof cap.registerPlugin !== 'function') return null;
  const isNative = typeof cap.isNativePlatform === 'function' ? cap.isNativePlatform() : false;
  if (!isNative) return null;
  try {
    return cap.registerPlugin('StepCounter');
  } catch {
    return null;
  }
}

/** Maps the Capacitor platform to our DailyStepTotal source tag. */
export function nativePlatform() {
  const cap = typeof window !== 'undefined' ? window.Capacitor : undefined;
  const p = cap && typeof cap.getPlatform === 'function' ? cap.getPlatform() : 'web';
  return p === 'ios' ? 'iphone' : p === 'android' ? 'android-phone' : 'manual';
}
