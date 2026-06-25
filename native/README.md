# Native step tracking (Capacitor)

Phone-only step counting. **No Apple Watch, smartwatch, ring, or GPS.** Only
steps recorded by the phone are counted.

> Steps are recorded when you carry your phone. Steps taken while your phone is
> left behind may not be counted.

These native sources back the JS `StepCounter` plugin used by
`features/steps/`. They are kept here (not inside `ios/` / `android/`) because
those native projects are generated locally and git-ignored.

## One-time setup

```bash
npm install
npm run build:web          # copies the web app into ./www
npx cap add ios            # macOS + Xcode only
npx cap add android        # Android Studio
npm run sync               # build:web + cap sync
```

## iOS — `CMPedometer`

1. Copy `native/ios/StepCounterPlugin.swift` into `ios/App/App/`.
2. In `ios/App/App/Info.plist` add the motion usage string (shown **before** the
   system prompt — see the privacy copy in `StepPermissionCard`):

   ```xml
   <key>NSMotionUsageDescription</key>
   <string>JARVIS reads your iPhone's motion data to count your daily steps. Step data stays on your device.</string>
   ```

3. Capacitor 6 auto-registers `CAPBridgedPlugin` classes — no `.m` file needed.

`CMPedometer` retains roughly 7 days of on-device history. Older days are kept
in the app's own database.

## Android — Health Connect + `TYPE_STEP_COUNTER`

1. Copy `native/android/StepCounterPlugin.kt` into
   `android/app/src/main/java/com/jarvis/fitness/steps/`.
2. Register it in `MainActivity`:

   ```java
   registerPlugin(com.jarvis.fitness.steps.StepCounterPlugin.class);
   ```

3. Add the Health Connect client to `android/app/build.gradle`:

   ```gradle
   implementation "androidx.health.connect:connect-client:1.1.0-alpha07"
   ```

4. Add permissions to `android/app/src/main/AndroidManifest.xml`:

   ```xml
   <!-- Legacy step-counter sensor (Android 10+) -->
   <uses-permission android:name="android.permission.ACTIVITY_RECOGNITION" />

   <!-- Health Connect read access -->
   <uses-permission android:name="android.permission.health.READ_STEPS" />

   <!-- Declare which Health Connect permissions the app can request -->
   <application>
     <activity-alias
       android:name="ViewPermissionUsageActivity"
       android:exported="true"
       android:targetActivity=".MainActivity"
       android:permission="android.permission.START_VIEW_PERMISSION_USAGE">
       <intent-filter>
         <action android:name="androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE" />
       </intent-filter>
     </activity-alias>
   </application>
   ```

The plugin prefers Health Connect when available (aggregation dedups records),
and falls back to `TYPE_STEP_COUNTER` with a reboot-safe per-day baseline.

## What the plugin does NOT do

- No raw-accelerometer step estimation (only the system step counter).
- No GPS for step counting.
- No raw motion samples leave the device — only **daily totals** are stored,
  and nothing is uploaded unless the user explicitly enables cloud sync.

---

# Barcode scanner (Nutrition) — native ML Kit

Inside the installed app, the web `BarcodeDetector` / WebView camera is
unreliable, so the Nutrition scanner uses the **native ML Kit barcode
scanner** when running in Capacitor (it auto-detects and falls back to the
web camera on the website). Install the plugin so the in-app scan works:

```bash
npm install @capacitor-mlkit/barcode-scanning
npm run sync          # build:web + cap sync
```

The web app calls it through Capacitor's runtime
(`Capacitor.registerPlugin('BarcodeScanner').scan()`), so no JS import or
rebuild of the web bundle is needed — just install the plugin and `cap sync`.

**iOS** — add to `ios/App/App/Info.plist`:

```xml
<key>NSCameraUsageDescription</key>
<string>JARVIS uses the camera to scan food barcodes.</string>
```

**Android** — ML Kit pulls its own dependencies via Gradle. To keep the
barcode model bundled at install time (instead of downloading on first use),
add to `android/app/src/main/AndroidManifest.xml` inside `<application>`:

```xml
<meta-data
  android:name="com.google.mlkit.vision.DEPENDENCIES"
  android:value="barcode_ui" />
```

That's it — rebuild the app and the Nutrition "Scan" button opens the native
scanner, reads the barcode, fills the number in, and looks it up in Open Food
Facts.

---

# Daily readiness from wearables (Apple Watch / WHOOP)

The morning check-in can pull a readiness score from a wearable instead of
the questions (`js/wearables.js`). If nothing is connected/available it falls
back to the questions automatically — so the website always works.

## Apple Watch (Apple Health / HealthKit) — native iOS only
Apple Health is unavailable in a browser, so this lights up only in the
installed iOS app. Install a HealthKit plugin and grant read access:

```bash
npm install @perfood/capacitor-healthkit
npm run sync
```

`ios/App/App/Info.plist`:

```xml
<key>NSHealthShareUsageDescription</key>
<string>JARVIS reads your Apple Watch sleep and recovery to estimate daily readiness.</string>
```

Enable the **HealthKit** capability in Xcode (Signing & Capabilities).
`wearables.js` reads sleep + HRV + resting HR and maps them to a 0–100 score.

## WHOOP (OAuth API)
The serverless token endpoint is already included at **`api/whoop/token.js`**
(Vercel deploys it automatically), and `js/wearables.js` is pre-wired to it
(`tokenProxy: '/api/whoop/token'`). To turn WHOOP on:

1. Create an app at **developer.whoop.com**; set the redirect URL to your site
   origin (e.g. `https://your-app.vercel.app/`).
2. In Vercel → Settings → **Environment Variables**, add `WHOOP_CLIENT_ID` and
   `WHOOP_CLIENT_SECRET` (the secret stays server-side, in the function).
3. Set `CFG.whoop.clientId` in `js/wearables.js` to the same client id (public —
   it only starts the OAuth redirect).

WHOOP's `recovery_score` (0–100) maps straight to the readiness number. Until
the client id + env vars are set, the WHOOP button honestly reports
"not set up" and the check-in uses the questions.

## Choosing the source (Settings)
**Settings → Daily readiness source** lets you pick *Ask me each morning*
(default), *Apple Watch*, *WHOOP*, or *Daily questions*. When set to a wearable,
the morning check-in connects to it automatically — still falling back to the
questions if it's unavailable. Stored in
`localStorage['jarvis_readiness_source_pref']`.

## Connections hub (`connections.html`)
A dedicated page lists every tracker, its connect method, and what it
provides, shows each connected source's latest stats, and surfaces the
**most accurate reading per metric** (recovery, sleep, HRV, resting HR,
steps) using a source-priority table in `js/wearables.js` (`PRIORITY`).
Connection state lives in `localStorage['jarvis_connections']`; cached
readings in `jarvis_conn_stats`.

**Apple Watch** and **WHOOP** are wired (see above). **Oura, Fitbit, Garmin,
Strava** are OAuth providers — wire each like WHOOP: register a developer
app, add a token endpoint (mirror `api/whoop/token.js`), then add its
`connect…()` + stat reader in `wearables.js`. Until then they honestly show
"Needs setup". **Health Connect** (Android) is native, like HealthKit.
