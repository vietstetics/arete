// Wires the custom native plugins into the generated (git-ignored) ios/ and
// android/ projects — automates every manual step in native/README.md.
// Idempotent: safe to re-run after `npx cap add` or a platform refresh.
//   node scripts/wire-native.mjs
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';

const log = (s) => console.log('  ' + s);
let did = 0;
function patch(file, test, apply, label) {
  if (!existsSync(file)) return;
  let src = readFileSync(file, 'utf8');
  if (test(src)) { log(`= ${label} (already wired)`); return; }
  writeFileSync(file, apply(src));
  log(`+ ${label}`);
  did++;
}

// ── Android ──────────────────────────────────────────────────────────────────
if (existsSync('android')) {
  console.log('android/');
  const pkgDir = 'android/app/src/main/java/com/jarvis/fitness';
  mkdirSync(`${pkgDir}/steps`, { recursive: true });
  mkdirSync(`${pkgDir}/health`, { recursive: true });
  copyFileSync('native/android/StepCounterPlugin.kt', `${pkgDir}/steps/StepCounterPlugin.kt`);
  copyFileSync('native/android/HealthPlugin.kt', `${pkgDir}/health/HealthPlugin.kt`);
  copyFileSync('native/android/PermissionsRationaleActivity.kt', `${pkgDir}/health/PermissionsRationaleActivity.kt`);
  log('+ plugin sources copied');

  patch(`${pkgDir}/MainActivity.java`,
    (s) => s.includes('HealthPlugin'),
    (s) => s
      .replace('import com.getcapacitor.BridgeActivity;',
        'import android.os.Bundle;\nimport com.getcapacitor.BridgeActivity;\nimport com.jarvis.fitness.health.HealthPlugin;\nimport com.jarvis.fitness.steps.StepCounterPlugin;')
      .replace('public class MainActivity extends BridgeActivity {}',
        'public class MainActivity extends BridgeActivity {\n    @Override\n    public void onCreate(Bundle savedInstanceState) {\n        registerPlugin(HealthPlugin.class);\n        registerPlugin(StepCounterPlugin.class);\n        super.onCreate(savedInstanceState);\n    }\n}'),
    'MainActivity registers HealthPlugin + StepCounterPlugin');

  patch('android/variables.gradle',
    (s) => /minSdkVersion = 2[6-9]/.test(s),
    (s) => s.replace(/minSdkVersion = \d+/, 'minSdkVersion = 26'),
    'variables.gradle: minSdk 26 (Health Connect requirement)');

  patch('android/build.gradle',
    (s) => s.includes('kotlin-gradle-plugin'),
    (s) => s.replace(/(classpath 'com\.android\.tools\.build:gradle[^']*')/,
      "$1\n        classpath 'org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.24'"),
    'root build.gradle: Kotlin gradle plugin');

  patch('android/app/build.gradle',
    (s) => s.includes('connect-client'),
    (s) => s
      .replace("apply plugin: 'com.android.application'",
        "apply plugin: 'com.android.application'\napply plugin: 'kotlin-android'")
      .replace(/dependencies\s*\{/,
        'dependencies {\n    implementation "androidx.health.connect:connect-client:1.1.0-alpha07"\n    implementation "org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1"\n    implementation "androidx.activity:activity-ktx:1.9.0"'),
    'app build.gradle: kotlin-android + Health Connect + coroutines');

  patch('android/app/src/main/AndroidManifest.xml',
    (s) => s.includes('READ_HEART_RATE'),
    (s) => s
      .replace('<application',
        [
          '<uses-permission android:name="android.permission.health.READ_STEPS"/>',
          '<uses-permission android:name="android.permission.health.READ_SLEEP"/>',
          '<uses-permission android:name="android.permission.health.READ_EXERCISE"/>',
          '<uses-permission android:name="android.permission.health.READ_ACTIVE_CALORIES_BURNED"/>',
          '<uses-permission android:name="android.permission.health.READ_DISTANCE"/>',
          '<uses-permission android:name="android.permission.health.READ_HEART_RATE"/>',
          '<uses-permission android:name="android.permission.health.READ_RESTING_HEART_RATE"/>',
          '<uses-permission android:name="android.permission.health.READ_HEART_RATE_VARIABILITY"/>',
          '<uses-permission android:name="android.permission.health.READ_WEIGHT"/>',
          '<uses-permission android:name="android.permission.health.READ_BODY_FAT"/>',
          '',
          '    <application',
        ].join('\n    '))
      .replace(/(<\/activity>)/,
        `$1

        <activity android:name="com.jarvis.fitness.health.PermissionsRationaleActivity" android:exported="true">
            <intent-filter>
                <action android:name="androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE"/>
            </intent-filter>
        </activity>
        <activity-alias
            android:name="ViewPermissionUsageActivity"
            android:exported="true"
            android:targetActivity="com.jarvis.fitness.health.PermissionsRationaleActivity"
            android:permission="android.permission.START_VIEW_PERMISSION_USAGE">
            <intent-filter>
                <action android:name="android.intent.action.VIEW_PERMISSION_USAGE"/>
                <category android:name="android.intent.category.HEALTH_PERMISSIONS"/>
            </intent-filter>
        </activity-alias>`),
    'AndroidManifest: health permissions + rationale activity');
}

// ── iOS ──────────────────────────────────────────────────────────────────────
if (existsSync('ios')) {
  console.log('ios/');
  copyFileSync('native/ios/HealthPlugin.swift', 'ios/App/App/HealthPlugin.swift');
  copyFileSync('native/ios/StepCounterPlugin.swift', 'ios/App/App/StepCounterPlugin.swift');
  log('+ plugin sources copied (add them to the App target in Xcode if not auto-detected)');

  patch('ios/App/App/Info.plist',
    (s) => s.includes('NSHealthShareUsageDescription'),
    (s) => s.replace('<key>CFBundleDevelopmentRegion</key>',
      `<key>NSHealthShareUsageDescription</key>
	<string>Arete reads your steps, sleep, workouts, heart data and body metrics from Apple Health to power your readiness, training history and progress tracking. Data stays on your device.</string>
	<key>NSMotionUsageDescription</key>
	<string>Arete reads your iPhone's motion data to count your daily steps. Step data stays on your device.</string>
	<key>CFBundleDevelopmentRegion</key>`),
    'Info.plist: HealthKit + Motion usage descriptions');

  console.log('  ! remaining Mac-only step: enable the HealthKit capability on the App target in Xcode');
}

console.log(did ? `\nwire-native: ${did} patch(es) applied.` : '\nwire-native: everything already wired.');
