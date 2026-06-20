import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The app is a static, multi-page web app. `npm run build:web` copies the
 * HTML/JS/asset files into ./www, which Capacitor bundles into the native
 * iOS/Android shells. The custom `StepCounter` plugin is implemented natively
 * under ./native (see native/README.md for wiring instructions).
 */
const config: CapacitorConfig = {
  appId: 'com.jarvis.fitness',
  appName: 'JARVIS',
  webDir: 'www',
};

export default config;
