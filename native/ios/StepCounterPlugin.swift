import Foundation
import Capacitor
import CoreMotion

// Custom Capacitor plugin: phone-only step tracking via Apple Core Motion.
// No HealthKit, no Apple Watch, no GPS. CMPedometer reads the iPhone's
// motion coprocessor step counts (retains ~7 days of history on-device).
//
// Wiring: drop this file into the generated `ios/App/App` group and add
//   NSMotionUsageDescription to Info.plist (see native/README.md).
@objc(StepCounterPlugin)
public class StepCounterPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StepCounterPlugin"
    public let jsName = "StepCounter"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getTodaySteps", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStepsForDate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStepsForRange", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startLiveUpdates", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopLiveUpdates", returnType: CAPPluginReturnPromise)
    ]

    private let pedometer = CMPedometer()
    private var isLive = false

    private func localDateString(_ date: Date) -> String {
        let f = DateFormatter()
        f.calendar = Calendar.current
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }

    private func startOfDay(_ date: Date) -> Date {
        return Calendar.current.startOfDay(for: date)
    }

    private func dateFromKey(_ key: String) -> Date? {
        let f = DateFormatter()
        f.calendar = Calendar.current
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.date(from: key)
    }

    // MARK: - Availability

    @objc func isAvailable(_ call: CAPPluginCall) {
        let available = CMPedometer.isStepCountingAvailable()
        call.resolve([
            "available": available,
            "reason": available ? "" : "Step counting is not available on this device."
        ])
    }

    // MARK: - Permission
    // CMPedometer has no explicit request API; issuing a query triggers the
    // system motion prompt. We resolve granted from the resulting auth status.

    @objc func requestPermission(_ call: CAPPluginCall) {
        guard CMPedometer.isStepCountingAvailable() else {
            call.resolve(["granted": false]); return
        }
        let now = Date()
        pedometer.queryPedometerData(from: startOfDay(now), to: now) { _, _ in
            let status = CMPedometer.authorizationStatus()
            call.resolve(["granted": status == .authorized])
        }
    }

    // MARK: - Reads

    @objc func getTodaySteps(_ call: CAPPluginCall) {
        let now = Date()
        pedometer.queryPedometerData(from: startOfDay(now), to: now) { data, error in
            if let error = error { call.reject("Failed to read steps", nil, error); return }
            call.resolve(["steps": data?.numberOfSteps.intValue ?? 0])
        }
    }

    @objc func getStepsForDate(_ call: CAPPluginCall) {
        guard let key = call.getString("date"), let day = dateFromKey(key) else {
            call.reject("A 'date' (YYYY-MM-DD) is required"); return
        }
        let start = startOfDay(day)
        let now = Date()
        // Cap end at "now" when the requested day is today.
        let nextMidnight = Calendar.current.date(byAdding: .day, value: 1, to: start) ?? start
        let end = min(nextMidnight, now)
        if end <= start { call.resolve(["steps": 0]); return }
        pedometer.queryPedometerData(from: start, to: end) { data, error in
            if error != nil { call.resolve(["steps": 0]); return }
            call.resolve(["steps": data?.numberOfSteps.intValue ?? 0])
        }
    }

    @objc func getStepsForRange(_ call: CAPPluginCall) {
        guard let startKey = call.getString("startDate"), let endKey = call.getString("endDate"),
              let startDay = dateFromKey(startKey), let endDay = dateFromKey(endKey) else {
            call.reject("'startDate' and 'endDate' (YYYY-MM-DD) are required"); return
        }
        let now = Date()
        var cursor = startOfDay(startDay)
        let lastDay = startOfDay(endDay)
        let group = DispatchGroup()
        var totals: [String: Int] = [:]
        let lock = NSLock()

        while cursor <= lastDay {
            let dayStart = cursor
            let key = localDateString(dayStart)
            let nextMidnight = Calendar.current.date(byAdding: .day, value: 1, to: dayStart) ?? dayStart
            let end = min(nextMidnight, now)
            if end > dayStart {
                group.enter()
                pedometer.queryPedometerData(from: dayStart, to: end) { data, _ in
                    let steps = data?.numberOfSteps.intValue ?? 0
                    lock.lock(); totals[key] = steps; lock.unlock()
                    group.leave()
                }
            } else {
                totals[key] = 0
            }
            cursor = nextMidnight
        }

        group.notify(queue: .main) {
            let source = "iphone"
            let result = totals
                .sorted { $0.key < $1.key }
                .map { ["date": $0.key, "steps": $0.value, "source": source] as [String: Any] }
            call.resolve(["totals": result])
        }
    }

    // MARK: - Live updates (app foreground)

    @objc func startLiveUpdates(_ call: CAPPluginCall) {
        guard CMPedometer.isStepCountingAvailable() else { call.reject("Step counting unavailable"); return }
        if isLive { call.resolve(); return }
        isLive = true
        pedometer.startUpdates(from: startOfDay(Date())) { [weak self] data, _ in
            guard let self = self, let data = data else { return }
            self.notifyListeners("stepUpdate", data: ["steps": data.numberOfSteps.intValue])
        }
        call.resolve()
    }

    @objc func stopLiveUpdates(_ call: CAPPluginCall) {
        if isLive { pedometer.stopUpdates(); isLive = false }
        call.resolve()
    }
}
