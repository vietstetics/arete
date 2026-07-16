import Foundation
import Capacitor
import HealthKit

// Connected Health — Apple HealthKit bridge (READ-ONLY).
// Reads: steps, sleep sessions, workouts, active calories, walking/running
// distance, heart rate, resting heart rate, HRV (SDNN), body weight and
// body-fat percentage. No write access is requested anywhere in this file.
//
// Wiring (see native/README.md → "Connected Health"):
//   1. Copy this file into the generated `ios/App/App` group.
//   2. Enable the HealthKit capability on the App target.
//   3. Add NSHealthShareUsageDescription to Info.plist.
// Capacitor 6 auto-registers CAPBridgedPlugin classes.
@objc(HealthPlugin)
public class HealthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HealthPlugin"
    public let jsName = "HealthPlugin"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPermissionStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "query", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise)
    ]

    private let store = HKHealthStore()

    private let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private let isoNoFrac: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
    private func parseISO(_ s: String?) -> Date? {
        guard let s = s else { return nil }
        return iso.date(from: s) ?? isoNoFrac.date(from: s)
    }
    private func fmt(_ d: Date) -> String { return iso.string(from: d) }
    private func dayKey(_ d: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: d)
    }

    // ── type map (read-only) ────────────────────────────────────────────────
    private func quantityType(_ t: String) -> HKQuantityType? {
        switch t {
        case "steps":              return HKQuantityType.quantityType(forIdentifier: .stepCount)
        case "active_calories":    return HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)
        case "distance":           return HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning)
        case "heart_rate":         return HKQuantityType.quantityType(forIdentifier: .heartRate)
        case "resting_heart_rate": return HKQuantityType.quantityType(forIdentifier: .restingHeartRate)
        case "hrv":                return HKQuantityType.quantityType(forIdentifier: .heartRateVariabilitySDNN)
        case "weight":             return HKQuantityType.quantityType(forIdentifier: .bodyMass)
        case "body_fat":           return HKQuantityType.quantityType(forIdentifier: .bodyFatPercentage)
        default:                   return nil
        }
    }
    private func readTypes(for names: [String]) -> Set<HKObjectType> {
        var out = Set<HKObjectType>()
        for n in names {
            if let q = quantityType(n) { out.insert(q) }
            else if n == "sleep", let s = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) { out.insert(s) }
            else if n == "workout" { out.insert(HKObjectType.workoutType()) }
        }
        return out
    }

    // ── methods ─────────────────────────────────────────────────────────────
    @objc func isAvailable(_ call: CAPPluginCall) {
        if HKHealthStore.isHealthDataAvailable() {
            call.resolve(["available": true])
        } else {
            call.resolve(["available": false, "reason": "Health data isn’t available on this device."])
        }
    }

    @objc func requestPermissions(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["granted": false]); return
        }
        let names = (call.getArray("types", String.self)) ?? []
        let read = readTypes(for: names)
        // READ ONLY: toShare is empty by design — Arete never writes health data.
        store.requestAuthorization(toShare: [], read: read) { ok, _ in
            // HealthKit does not reveal read-permission outcomes; report honestly.
            var perType: [String: String] = [:]
            for n in names { perType[n] = "unknown" }
            call.resolve(["granted": ok, "perType": perType])
        }
    }

    @objc func getPermissionStatus(_ call: CAPPluginCall) {
        // Read status is intentionally opaque in HealthKit.
        call.resolve(["state": "unknown"])
    }

    @objc func openSettings(_ call: CAPPluginCall) {
        // iOS offers no direct deep link into Health permissions.
        call.resolve()
    }

    @objc func query(_ call: CAPPluginCall) {
        guard let type = call.getString("type"),
              let start = parseISO(call.getString("startISO")),
              let end = parseISO(call.getString("endISO")) else {
            call.reject("type, startISO and endISO are required"); return
        }
        switch type {
        case "steps", "active_calories", "distance":
            dailySum(type: type, start: start, end: end, call: call)
        case "heart_rate", "resting_heart_rate", "hrv":
            dailyAverage(type: type, start: start, end: end, call: call)
        case "sleep":
            sleepSessions(start: start, end: end, call: call)
        case "workout":
            workouts(start: start, end: end, call: call)
        case "weight", "body_fat":
            samples(type: type, start: start, end: end, call: call)
        default:
            call.reject("Unsupported type: " + type)
        }
    }

    // ── daily statistics (sum) ──────────────────────────────────────────────
    private func dailySum(type: String, start: Date, end: Date, call: CAPPluginCall) {
        guard let qt = quantityType(type) else { call.reject("Bad type"); return }
        let unit: HKUnit = type == "steps" ? .count() : (type == "distance" ? .meter() : .kilocalorie())
        let unitName = type == "steps" ? "count" : (type == "distance" ? "m" : "kcal")
        statistics(qt: qt, options: .cumulativeSum, start: start, end: end) { stats in
            var records: [[String: Any]] = []
            for s in stats {
                guard let q = s.sumQuantity() else { continue }
                records.append([
                    "sourceRecordId": "daily-\(type)-\(self.dayKey(s.startDate))",
                    "startTime": self.fmt(s.startDate),
                    "endTime": self.fmt(s.endDate),
                    "value": q.doubleValue(for: unit),
                    "unit": unitName
                ])
            }
            call.resolve(["records": records])
        }
    }

    // ── daily statistics (average) ──────────────────────────────────────────
    private func dailyAverage(type: String, start: Date, end: Date, call: CAPPluginCall) {
        guard let qt = quantityType(type) else { call.reject("Bad type"); return }
        let unit: HKUnit = type == "hrv" ? HKUnit.secondUnit(with: .milli) : HKUnit.count().unitDivided(by: .minute())
        let unitName = type == "hrv" ? "ms" : "bpm"
        statistics(qt: qt, options: .discreteAverage, start: start, end: end) { stats in
            var records: [[String: Any]] = []
            for s in stats {
                guard let q = s.averageQuantity() else { continue }
                records.append([
                    "sourceRecordId": "daily-\(type)-\(self.dayKey(s.startDate))",
                    "startTime": self.fmt(s.startDate),
                    "endTime": self.fmt(s.endDate),
                    "value": q.doubleValue(for: unit),
                    "unit": unitName
                ])
            }
            call.resolve(["records": records])
        }
    }

    private func statistics(qt: HKQuantityType, options: HKStatisticsOptions, start: Date, end: Date, done: @escaping ([HKStatistics]) -> Void) {
        var day = DateComponents(); day.day = 1
        let anchor = Calendar.current.startOfDay(for: start)
        let q = HKStatisticsCollectionQuery(
            quantityType: qt,
            quantitySamplePredicate: HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate),
            options: options, anchorDate: anchor, intervalComponents: day)
        q.initialResultsHandler = { _, collection, _ in
            var out: [HKStatistics] = []
            collection?.enumerateStatistics(from: start, to: end) { s, _ in out.append(s) }
            done(out)
        }
        store.execute(q)
    }

    // ── sleep sessions ──────────────────────────────────────────────────────
    private func sleepSessions(start: Date, end: Date, call: CAPPluginCall) {
        guard let st = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) else { call.reject("No sleep type"); return }
        let pred = HKQuery.predicateForSamples(withStart: start, end: end, options: [])
        let q = HKSampleQuery(sampleType: st, predicate: pred, limit: 2000,
                              sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]) { _, samples, _ in
            var records: [[String: Any]] = []
            for s in (samples as? [HKCategorySample]) ?? [] {
                // only time actually asleep (all asleep* values; not inBed/awake)
                let v = s.value
                let asleepValues: [Int]
                if #available(iOS 16.0, *) {
                    asleepValues = [HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue,
                                    HKCategoryValueSleepAnalysis.asleepCore.rawValue,
                                    HKCategoryValueSleepAnalysis.asleepDeep.rawValue,
                                    HKCategoryValueSleepAnalysis.asleepREM.rawValue]
                } else {
                    asleepValues = [HKCategoryValueSleepAnalysis.asleep.rawValue]
                }
                guard asleepValues.contains(v) else { continue }
                let minutes = s.endDate.timeIntervalSince(s.startDate) / 60.0
                records.append([
                    "sourceRecordId": s.uuid.uuidString,
                    "startTime": self.fmt(s.startDate),
                    "endTime": self.fmt(s.endDate),
                    "value": minutes,
                    "unit": "min",
                    "sourceDevice": s.sourceRevision.source.name
                ])
            }
            call.resolve(["records": records])
        }
        store.execute(q)
    }

    // ── workouts ────────────────────────────────────────────────────────────
    private func workouts(start: Date, end: Date, call: CAPPluginCall) {
        let pred = HKQuery.predicateForSamples(withStart: start, end: end, options: [])
        let q = HKSampleQuery(sampleType: HKObjectType.workoutType(), predicate: pred, limit: 500,
                              sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]) { _, samples, _ in
            var records: [[String: Any]] = []
            for w in (samples as? [HKWorkout]) ?? [] {
                var meta: [String: Any] = ["activityType": self.activityName(w.workoutActivityType)]
                if let kcal = w.totalEnergyBurned?.doubleValue(for: .kilocalorie()) { meta["calories"] = kcal }
                records.append([
                    "sourceRecordId": w.uuid.uuidString,
                    "startTime": self.fmt(w.startDate),
                    "endTime": self.fmt(w.endDate),
                    "value": w.duration / 60.0,
                    "unit": "min",
                    "sourceDevice": w.sourceRevision.source.name,
                    "meta": meta
                ])
            }
            call.resolve(["records": records])
        }
        store.execute(q)
    }

    private func activityName(_ t: HKWorkoutActivityType) -> String {
        switch t {
        case .running: return "Running"
        case .walking: return "Walking"
        case .cycling: return "Cycling"
        case .swimming: return "Swimming"
        case .traditionalStrengthTraining, .functionalStrengthTraining: return "Strength Training"
        case .highIntensityIntervalTraining: return "HIIT"
        case .yoga: return "Yoga"
        case .rowing: return "Rowing"
        case .elliptical: return "Elliptical"
        case .hiking: return "Hiking"
        case .soccer: return "Football"
        case .basketball: return "Basketball"
        default: return "Workout"
        }
    }

    // ── individual samples (weight / body fat) ──────────────────────────────
    private func samples(type: String, start: Date, end: Date, call: CAPPluginCall) {
        guard let qt = quantityType(type) else { call.reject("Bad type"); return }
        let pred = HKQuery.predicateForSamples(withStart: start, end: end, options: [])
        let q = HKSampleQuery(sampleType: qt, predicate: pred, limit: 500,
                              sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]) { _, samples, _ in
            var records: [[String: Any]] = []
            for s in (samples as? [HKQuantitySample]) ?? [] {
                let value: Double
                let unit: String
                if type == "weight" {
                    value = s.quantity.doubleValue(for: .gramUnit(with: .kilo)); unit = "kg"
                } else {
                    value = s.quantity.doubleValue(for: .percent()) * 100.0; unit = "%"
                }
                records.append([
                    "sourceRecordId": s.uuid.uuidString,
                    "startTime": self.fmt(s.startDate),
                    "endTime": self.fmt(s.endDate),
                    "value": value,
                    "unit": unit,
                    "sourceDevice": s.sourceRevision.source.name
                ])
            }
            call.resolve(["records": records])
        }
        store.execute(q)
    }
}
