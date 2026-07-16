package com.jarvis.fitness.health

import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.BodyFatRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.Period
import java.time.ZoneId
import java.time.format.DateTimeFormatter

// Connected Health — Android Health Connect bridge (READ-ONLY).
// Reads: steps, sleep sessions, exercise sessions, active calories, distance,
// heart rate, resting heart rate, HRV (RMSSD, where available), body weight,
// body-fat percentage. Health Connect only — NOT the deprecated Google Fit API.
//
// Wiring (see native/README.md → "Connected Health"): manifest permissions,
// the permissions-rationale intent filter, and the Health Connect dependency
//   implementation "androidx.health.connect:connect-client:1.1.0-alpha07"
@CapacitorPlugin(name = "HealthPlugin")
class HealthPlugin : Plugin() {

    private val scope = CoroutineScope(Dispatchers.Main)
    private var permissionLauncher: ActivityResultLauncher<Set<String>>? = null
    private var pendingPermissionCall: PluginCall? = null

    private val readPermissions: Set<String> by lazy {
        setOf(
            HealthPermission.getReadPermission(StepsRecord::class),
            HealthPermission.getReadPermission(SleepSessionRecord::class),
            HealthPermission.getReadPermission(ExerciseSessionRecord::class),
            HealthPermission.getReadPermission(ActiveCaloriesBurnedRecord::class),
            HealthPermission.getReadPermission(DistanceRecord::class),
            HealthPermission.getReadPermission(HeartRateRecord::class),
            HealthPermission.getReadPermission(RestingHeartRateRecord::class),
            HealthPermission.getReadPermission(HeartRateVariabilityRmssdRecord::class),
            HealthPermission.getReadPermission(WeightRecord::class),
            HealthPermission.getReadPermission(BodyFatRecord::class),
        )
    }

    override fun load() {
        val activity = activity as? ComponentActivity ?: return
        permissionLauncher = activity.registerForActivityResult(
            PermissionController.createRequestPermissionResultContract()
        ) { granted ->
            val call = pendingPermissionCall ?: return@registerForActivityResult
            pendingPermissionCall = null
            val res = JSObject()
            val perType = JSObject()
            var any = false
            for (p in readPermissions) {
                val ok = granted.contains(p)
                if (ok) any = true
                perType.put(p.substringAfterLast('.'), if (ok) "granted" else "denied")
            }
            res.put("granted", granted.containsAll(readPermissions))
            if (!granted.containsAll(readPermissions) && any) res.put("partial", true)
            res.put("perType", perType)
            call.resolve(res)
        }
    }

    private fun client(): HealthConnectClient? {
        return try {
            if (HealthConnectClient.getSdkStatus(context) == HealthConnectClient.SDK_AVAILABLE)
                HealthConnectClient.getOrCreate(context) else null
        } catch (e: Exception) { null }
    }

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        val status = HealthConnectClient.getSdkStatus(context)
        val res = JSObject()
        when (status) {
            HealthConnectClient.SDK_AVAILABLE -> res.put("available", true)
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> {
                res.put("available", false)
                res.put("reason", "Health Connect needs an update — install it from the Play Store.")
            }
            else -> {
                res.put("available", false)
                res.put("reason", "Health Connect isn’t available on this phone.")
            }
        }
        call.resolve(res)
    }

    @PluginMethod
    fun requestHealthPermissions(call: PluginCall) {
        val launcher = permissionLauncher
        if (client() == null || launcher == null) {
            call.reject("Health Connect isn’t available."); return
        }
        pendingPermissionCall = call
        launcher.launch(readPermissions)
    }

    @PluginMethod
    fun getPermissionStatus(call: PluginCall) {
        val c = client() ?: run { call.resolve(JSObject().put("state", "denied")); return }
        scope.launch {
            try {
                val granted = c.permissionController.getGrantedPermissions()
                val state = when {
                    granted.containsAll(readPermissions) -> "granted"
                    granted.any { readPermissions.contains(it) } -> "partial"
                    else -> "not_requested"
                }
                call.resolve(JSObject().put("state", state))
            } catch (e: Exception) {
                call.resolve(JSObject().put("state", "unknown"))
            }
        }
    }

    @PluginMethod
    fun openSettings(call: PluginCall) {
        try {
            val intent = android.content.Intent(
                androidx.health.connect.client.HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS
            )
            activity.startActivity(intent)
        } catch (e: Exception) { /* settings screen unavailable */ }
        call.resolve()
    }

    // ── query ────────────────────────────────────────────────────────────────
    @PluginMethod
    fun query(call: PluginCall) {
        val type = call.getString("type") ?: run { call.reject("type required"); return }
        val start = call.getString("startISO")?.let { Instant.parse(it) } ?: run { call.reject("startISO required"); return }
        val end = call.getString("endISO")?.let { Instant.parse(it) } ?: run { call.reject("endISO required"); return }
        val c = client() ?: run { call.reject("Health Connect unavailable"); return }

        scope.launch {
            try {
                val records = when (type) {
                    "steps" -> dailyAggregate(c, start, end, StepsRecord.COUNT_TOTAL, "steps", "count") { it.toDouble() }
                    "distance" -> dailyAggregate(c, start, end, DistanceRecord.DISTANCE_TOTAL, "distance", "m") { it.inMeters }
                    "active_calories" -> dailyAggregate(c, start, end, ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL, "active_calories", "kcal") { it.inKilocalories }
                    "heart_rate" -> dailyAggregateLong(c, start, end, HeartRateRecord.BPM_AVG, "heart_rate", "bpm")
                    "resting_heart_rate" -> dailyAggregateLong(c, start, end, RestingHeartRateRecord.BPM_AVG, "resting_heart_rate", "bpm")
                    "hrv" -> hrvDaily(c, start, end)
                    "sleep" -> sleepSessions(c, start, end)
                    "workout" -> exerciseSessions(c, start, end)
                    "weight" -> weightSamples(c, start, end)
                    "body_fat" -> bodyFatSamples(c, start, end)
                    else -> { call.reject("Unsupported type: $type"); return@launch }
                }
                call.resolve(JSObject().put("records", records))
            } catch (e: SecurityException) {
                call.reject("Permission not granted for $type")
            } catch (e: Exception) {
                call.reject("Query failed: ${e.message}")
            }
        }
    }

    private val isoFmt: DateTimeFormatter = DateTimeFormatter.ISO_INSTANT
    private fun iso(i: Instant): String = isoFmt.format(i)
    private fun dayOf(i: Instant): LocalDate = i.atZone(ZoneId.systemDefault()).toLocalDate()

    private suspend fun <T : Any> dailyAggregate(
        c: HealthConnectClient, start: Instant, end: Instant,
        metric: androidx.health.connect.client.aggregate.AggregateMetric<T>,
        typeName: String, unit: String, toDouble: (T) -> Double
    ): JSArray {
        val out = JSArray()
        val resp = c.aggregateGroupByPeriod(
            AggregateGroupByPeriodRequest(
                metrics = setOf(metric),
                timeRangeFilter = TimeRangeFilter.between(
                    start.atZone(ZoneId.systemDefault()).toLocalDateTime(),
                    end.atZone(ZoneId.systemDefault()).toLocalDateTime()
                ),
                timeRangeSlicer = Period.ofDays(1)
            )
        )
        for (bucket in resp) {
            val v = bucket.result[metric] ?: continue
            val startI = bucket.startTime.atZone(ZoneId.systemDefault()).toInstant()
            val endI = bucket.endTime.atZone(ZoneId.systemDefault()).toInstant()
            out.put(JSObject().apply {
                put("sourceRecordId", "daily-$typeName-${dayOf(startI)}")
                put("startTime", iso(startI))
                put("endTime", iso(endI))
                put("value", toDouble(v))
                put("unit", unit)
            })
        }
        return out
    }

    private suspend fun dailyAggregateLong(
        c: HealthConnectClient, start: Instant, end: Instant,
        metric: androidx.health.connect.client.aggregate.AggregateMetric<Long>,
        typeName: String, unit: String
    ): JSArray = dailyAggregate(c, start, end, metric, typeName, unit) { it.toDouble() }

    private suspend fun hrvDaily(c: HealthConnectClient, start: Instant, end: Instant): JSArray {
        // No aggregate metric for HRV — read samples and average per local day.
        val resp = c.readRecords(ReadRecordsRequest(HeartRateVariabilityRmssdRecord::class, TimeRangeFilter.between(start, end)))
        val byDay = HashMap<LocalDate, MutableList<Double>>()
        for (r in resp.records) byDay.getOrPut(dayOf(r.time)) { mutableListOf() }.add(r.heartRateVariabilityMillis)
        val out = JSArray()
        for ((day, values) in byDay) {
            val startI = day.atStartOfDay(ZoneId.systemDefault()).toInstant()
            out.put(JSObject().apply {
                put("sourceRecordId", "daily-hrv-$day")
                put("startTime", iso(startI))
                put("value", values.average())
                put("unit", "ms")
            })
        }
        return out
    }

    private suspend fun sleepSessions(c: HealthConnectClient, start: Instant, end: Instant): JSArray {
        val resp = c.readRecords(ReadRecordsRequest(SleepSessionRecord::class, TimeRangeFilter.between(start, end)))
        val out = JSArray()
        for (r in resp.records) {
            val minutes = (r.endTime.epochSecond - r.startTime.epochSecond) / 60.0
            out.put(JSObject().apply {
                put("sourceRecordId", r.metadata.id)
                put("startTime", iso(r.startTime))
                put("endTime", iso(r.endTime))
                put("value", minutes)
                put("unit", "min")
                put("sourceDevice", r.metadata.dataOrigin.packageName)
            })
        }
        return out
    }

    private suspend fun exerciseSessions(c: HealthConnectClient, start: Instant, end: Instant): JSArray {
        val resp = c.readRecords(ReadRecordsRequest(ExerciseSessionRecord::class, TimeRangeFilter.between(start, end)))
        val out = JSArray()
        for (r in resp.records) {
            val minutes = (r.endTime.epochSecond - r.startTime.epochSecond) / 60.0
            val meta = JSObject().put("activityType", exerciseName(r.exerciseType))
            out.put(JSObject().apply {
                put("sourceRecordId", r.metadata.id)
                put("startTime", iso(r.startTime))
                put("endTime", iso(r.endTime))
                put("value", minutes)
                put("unit", "min")
                put("sourceDevice", r.metadata.dataOrigin.packageName)
                put("meta", meta)
            })
        }
        return out
    }

    private fun exerciseName(t: Int): String = when (t) {
        ExerciseSessionRecord.EXERCISE_TYPE_RUNNING -> "Running"
        ExerciseSessionRecord.EXERCISE_TYPE_WALKING -> "Walking"
        ExerciseSessionRecord.EXERCISE_TYPE_BIKING -> "Cycling"
        ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_POOL,
        ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_OPEN_WATER -> "Swimming"
        ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING,
        ExerciseSessionRecord.EXERCISE_TYPE_WEIGHTLIFTING -> "Strength Training"
        ExerciseSessionRecord.EXERCISE_TYPE_HIGH_INTENSITY_INTERVAL_TRAINING -> "HIIT"
        ExerciseSessionRecord.EXERCISE_TYPE_YOGA -> "Yoga"
        ExerciseSessionRecord.EXERCISE_TYPE_ROWING, ExerciseSessionRecord.EXERCISE_TYPE_ROWING_MACHINE -> "Rowing"
        ExerciseSessionRecord.EXERCISE_TYPE_ELLIPTICAL -> "Elliptical"
        ExerciseSessionRecord.EXERCISE_TYPE_HIKING -> "Hiking"
        else -> "Workout"
    }

    private suspend fun weightSamples(c: HealthConnectClient, start: Instant, end: Instant): JSArray {
        val resp = c.readRecords(ReadRecordsRequest(WeightRecord::class, TimeRangeFilter.between(start, end)))
        val out = JSArray()
        for (r in resp.records) out.put(JSObject().apply {
            put("sourceRecordId", r.metadata.id)
            put("startTime", iso(r.time))
            put("value", r.weight.inKilograms)
            put("unit", "kg")
            put("sourceDevice", r.metadata.dataOrigin.packageName)
        })
        return out
    }

    private suspend fun bodyFatSamples(c: HealthConnectClient, start: Instant, end: Instant): JSArray {
        val resp = c.readRecords(ReadRecordsRequest(BodyFatRecord::class, TimeRangeFilter.between(start, end)))
        val out = JSArray()
        for (r in resp.records) out.put(JSObject().apply {
            put("sourceRecordId", r.metadata.id)
            put("startTime", iso(r.time))
            put("value", r.percentage.value)
            put("unit", "%")
            put("sourceDevice", r.metadata.dataOrigin.packageName)
        })
        return out
    }
}
