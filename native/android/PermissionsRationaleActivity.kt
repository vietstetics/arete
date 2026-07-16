package com.jarvis.fitness.health

import android.app.Activity
import android.os.Bundle
import android.widget.ScrollView
import android.widget.TextView

// Shown when the user taps the privacy-policy link on Android's Health Connect
// permission sheet (androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE).
// Mirrors the in-app primer copy: read-only, on-device, no ads, revocable.
class PermissionsRationaleActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val text = TextView(this).apply {
            setPadding(48, 64, 48, 64)
            textSize = 15f
            text = """
                Arete & your health data

                Arete asks Health Connect for READ-ONLY access to: steps, sleep,
                exercise sessions, active calories, distance, heart rate, resting
                heart rate, heart-rate variability, weight and body-fat percentage.

                Why: steps power your step tracker, sleep improves your Morning
                Check-In (you confirm before it's used), workouts appear in your
                training history, heart data refines your readiness score, and
                weight/body-fat feed progress tracking.

                • Arete never writes to Health Connect.
                • Health data stays on your device — it is not uploaded.
                • It is never used for advertising.
                • Access is optional; revoke any time in Health Connect settings,
                  or disconnect inside Arete.
            """.trimIndent()
        }
        setContentView(ScrollView(this).apply { addView(text) })
    }
}
