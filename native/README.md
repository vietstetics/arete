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
