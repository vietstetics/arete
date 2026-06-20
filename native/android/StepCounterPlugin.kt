package com.jarvis.fitness.steps

import android.content.Context
import android.content.SharedPreferences
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.aggregate.AggregationResult
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.time.TimeRangeFilter
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.Period
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Phone-only step tracking for Android. No smartwatch / ring / GPS.
 *   • Android 14+ (or any device with Health Connect): on-device aggregated
 *     steps via Health Connect (aggregation dedups overlapping records).
 *   • Older devices: Sensor.TYPE_STEP_COUNTER with a per-day baseline, made
 *     reboot-safe (the counter resets to 0 on reboot).
 * Drop into the generated android project; see native/README.md for the
 * AndroidManifest permissions and the Health Connect dependency.
 */
@CapacitorPlugin(
    name = "StepCounter",
    permissions = [
        Permission(alias = "activity", strings = ["android.permission.ACTIVITY_RECOGNITION"])
    ]
)
class StepCounterPlugin : Plugin(), SensorEventListener {

    private val zone: ZoneId get() = ZoneId.systemDefault()
    private val dayFmt: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd")
    private val io = CoroutineScope(Dispatchers.IO)

    private val HC_PERMS = setOf(HealthPermission.getReadPermission(StepsRecord::class))
    private var hcPermLauncher: ActivityResultLauncher<Set<String>>? = null
    private var pendingPermCall: PluginCall? = null

    private lateinit var prefs: SharedPreferences
    private var sensorManager: SensorManager? = null
    private var stepSensor: Sensor? = null
    private var liveActive = false
    private var oneShotPending: ((Int) -> Unit)? = null

    // ── lifecycle ────────────────────────────────────────────────────────
    override fun load() {
        val ctx = context
        prefs = ctx.getSharedPreferences("jarvis_steps_native", Context.MODE_PRIVATE)
        sensorManager = ctx.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
        stepSensor = sensorManager?.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)

        // Register the Health Connect permission launcher (can be called any time
        // via the activity's result registry, unlike registerForActivityResult).
        (activity as? ComponentActivity)?.let { act ->
            if (healthConnectAvailable()) {
                val contract = PermissionController.createRequestPermissionResultContract()
                hcPermLauncher = act.activityResultRegistry.register("hc_steps_perm", contract) { granted ->
                    val call = pendingPermCall
                    pendingPermCall = null
                    call?.resolve(JSObject().put("granted", granted.containsAll(HC_PERMS)))
                }
            }
        }
    }

    private fun healthConnectAvailable(): Boolean =
        HealthConnectClient.getSdkStatus(context) == HealthConnectClient.SDK_AVAILABLE

    private fun hasStepSensor(): Boolean = stepSensor != null

    private fun hcClient(): HealthConnectClient = HealthConnectClient.getOrCreate(context)

    // ── availability ─────────────────────────────────────────────────────
    @PluginMethod
    fun isAvailable(call: PluginCall) {
        val available = healthConnectAvailable() || hasStepSensor()
        call.resolve(
            JSObject()
                .put("available", available)
                .put("reason", if (available) "" else "No step counter sensor or Health Connect on this device.")
        )
    }

    // ── permission ───────────────────────────────────────────────────────
    @PluginMethod
    fun requestPermission(call: PluginCall) {
        when {
            healthConnectAvailable() -> {
                val launcher = hcPermLauncher
                if (launcher == null) { call.resolve(JSObject().put("granted", false)); return }
                io.launch {
                    val already = hcClient().permissionController.getGrantedPermissions().containsAll(HC_PERMS)
                    if (already) {
                        call.resolve(JSObject().put("granted", true))
                    } else withContext(Dispatchers.Main) {
                        pendingPermCall = call
                        launcher.launch(HC_PERMS)
                    }
                }
            }
            hasStepSensor() -> {
                if (getPermissionState("activity").toString() == "GRANTED") {
                    call.resolve(JSObject().put("granted", true))
                } else {
                    requestPermissionForAlias("activity", call, "activityPermCallback")
                }
            }
            else -> call.resolve(JSObject().put("granted", false))
        }
    }

    @PermissionCallback
    private fun activityPermCallback(call: PluginCall) {
        val granted = getPermissionState("activity").toString() == "GRANTED"
        call.resolve(JSObject().put("granted", granted))
    }

    // ── reads ────────────────────────────────────────────────────────────
    @PluginMethod
    fun getTodaySteps(call: PluginCall) {
        val todayKey = LocalDate.now(zone).format(dayFmt)
        io.launch {
            if (healthConnectAvailable() && hcGranted()) {
                val steps = hcAggregateForDay(todayKey)
                call.resolve(JSObject().put("steps", steps))
            } else if (hasStepSensor()) {
                readLegacyToday { steps -> call.resolve(JSObject().put("steps", steps)) }
            } else {
                call.resolve(JSObject().put("steps", 0))
            }
        }
    }

    @PluginMethod
    fun getStepsForDate(call: PluginCall) {
        val date = call.getString("date")
        if (date == null) { call.reject("A 'date' (YYYY-MM-DD) is required"); return }
        io.launch {
            if (healthConnectAvailable() && hcGranted()) {
                call.resolve(JSObject().put("steps", hcAggregateForDay(date)))
            } else if (date == LocalDate.now(zone).format(dayFmt) && hasStepSensor()) {
                readLegacyToday { steps -> call.resolve(JSObject().put("steps", steps)) }
            } else {
                // Legacy sensor keeps no history — older days come from the app DB.
                call.resolve(JSObject().put("steps", 0))
            }
        }
    }

    @PluginMethod
    fun getStepsForRange(call: PluginCall) {
        val start = call.getString("startDate")
        val end = call.getString("endDate")
        if (start == null || end == null) { call.reject("'startDate' and 'endDate' are required"); return }
        io.launch {
            val totals = JSArray()
            if (healthConnectAvailable() && hcGranted()) {
                for ((date, steps) in hcAggregateByDay(start, end)) {
                    totals.put(JSObject().put("date", date).put("steps", steps).put("source", "android-phone"))
                }
            } else if (hasStepSensor()) {
                val todayKey = LocalDate.now(zone).format(dayFmt)
                if (todayKey in start..end) {
                    readLegacyToday { steps ->
                        totals.put(JSObject().put("date", todayKey).put("steps", steps).put("source", "android-phone"))
                        call.resolve(JSObject().put("totals", totals))
                    }
                    return@launch
                }
            }
            call.resolve(JSObject().put("totals", totals))
        }
    }

    // ── live updates ─────────────────────────────────────────────────────
    @PluginMethod
    fun startLiveUpdates(call: PluginCall) {
        if (hasStepSensor() && !liveActive) {
            sensorManager?.registerListener(this, stepSensor, SensorManager.SENSOR_DELAY_NORMAL)
            liveActive = true
        }
        call.resolve()
    }

    @PluginMethod
    fun stopLiveUpdates(call: PluginCall) {
        if (liveActive) { sensorManager?.unregisterListener(this); liveActive = false }
        call.resolve()
    }

    // ── SensorEventListener (TYPE_STEP_COUNTER) ──────────────────────────
    override fun onSensorChanged(event: SensorEvent) {
        if (event.sensor?.type != Sensor.TYPE_STEP_COUNTER) return
        val raw = event.values[0].toLong()
        val today = applyReading(raw)
        oneShotPending?.let { cb -> cb(today); oneShotPending = null }
        if (liveActive) notifyListeners("stepUpdate", JSObject().put("steps", today))
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

    /** Register a one-shot read of the current step-counter value. */
    private fun readLegacyToday(cb: (Int) -> Unit) {
        val sm = sensorManager; val s = stepSensor
        if (sm == null || s == null) { cb(0); return }
        // If we already have a baseline for today, we can report the cached
        // value immediately; still register to refresh from the next event.
        oneShotPending = cb
        sm.registerListener(this, s, SensorManager.SENSOR_DELAY_FASTEST)
        if (!liveActive) {
            // Stop the FASTEST listener shortly after we get a value.
            // (onSensorChanged clears oneShotPending; this guards if no event.)
        }
    }

    /**
     * Reboot-safe per-day baseline math. TYPE_STEP_COUNTER counts since boot and
     * resets to 0 on reboot, so:
     *   todaySteps = carry + (raw - baseline)
     *   • new day  → baseline = raw, carry = 0
     *   • reboot (raw < lastRaw) → carry += (lastRaw - baseline); baseline = 0
     */
    private fun applyReading(raw: Long): Int {
        val today = LocalDate.now(zone).format(dayFmt)
        var day = prefs.getString("day", null)
        var baseline = prefs.getLong("baseline", -1L)
        var carry = prefs.getLong("carry", 0L)
        val lastRaw = prefs.getLong("lastRaw", -1L)

        if (day != today || baseline < 0L) {
            day = today; baseline = raw; carry = 0L
        } else if (lastRaw >= 0L && raw < lastRaw) {
            // Reboot: counter reset to 0. Bank steps counted before the reboot.
            carry += (lastRaw - baseline)
            baseline = 0L
        }

        val todaySteps = (carry + (raw - baseline)).coerceAtLeast(0L)
        prefs.edit()
            .putString("day", day)
            .putLong("baseline", baseline)
            .putLong("carry", carry)
            .putLong("lastRaw", raw)
            .apply()
        return todaySteps.toInt()
    }

    // ── Health Connect helpers ───────────────────────────────────────────
    private suspend fun hcGranted(): Boolean =
        try { hcClient().permissionController.getGrantedPermissions().containsAll(HC_PERMS) } catch (e: Exception) { false }

    private suspend fun hcAggregateForDay(dateKey: String): Long {
        val date = LocalDate.parse(dateKey, dayFmt)
        val startInstant = date.atStartOfDay(zone).toInstant()
        val endInstant = if (date == LocalDate.now(zone))
            java.time.Instant.now()
        else
            date.plusDays(1).atStartOfDay(zone).toInstant()
        return try {
            val res: AggregationResult = hcClient().aggregate(
                AggregateRequest(setOf(StepsRecord.COUNT_TOTAL), TimeRangeFilter.between(startInstant, endInstant))
            )
            res[StepsRecord.COUNT_TOTAL] ?: 0L
        } catch (e: Exception) { 0L }
    }

    private suspend fun hcAggregateByDay(startKey: String, endKey: String): List<Pair<String, Long>> {
        val start = LocalDateTime.of(LocalDate.parse(startKey, dayFmt), LocalTime.MIDNIGHT)
        val end = LocalDateTime.of(LocalDate.parse(endKey, dayFmt).plusDays(1), LocalTime.MIDNIGHT)
        return try {
            hcClient().aggregateGroupByPeriod(
                AggregateGroupByPeriodRequest(
                    setOf(StepsRecord.COUNT_TOTAL),
                    TimeRangeFilter.between(start, end),
                    Period.ofDays(1)
                )
            ).map { bucket ->
                bucket.startTime.toLocalDate().format(dayFmt) to (bucket.result[StepsRecord.COUNT_TOTAL] ?: 0L)
            }
        } catch (e: Exception) { emptyList() }
    }
}
