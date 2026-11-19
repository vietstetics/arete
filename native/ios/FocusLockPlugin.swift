import Foundation
import Capacitor
import SwiftUI
import FamilyControls
import ManagedSettings

// Custom Capacitor plugin: lock-in mode. While a workout runs, the apps the user picked
// (Instagram, TikTok, YouTube, Snapchat, …) show Apple's Screen Time shield instead of opening.
//
// Apple's Screen Time API (iOS 16+, "individual" authorisation: the phone's own user, no parent
// account). Apps can't be named in code: the user ticks them once in Apple's picker and Apple hands
// back private tokens, saved here (FamilyActivitySelection is Codable).
//
// Wiring: see native/README.md "Lock-in mode". Needs the Family Controls capability
// (com.apple.developer.family-controls); App Store / TestFlight builds need Apple's approval for it.
@objc(FocusLockPlugin)
public class FocusLockPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FocusLockPlugin"
    public let jsName = "FocusLock"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setup", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "lock", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unlock", returnType: CAPPluginReturnPromise)
    ]

    private static let selectionKey = "arete.focuslock.selection"
    private static let lockedKey = "arete.focuslock.locked"

    @available(iOS 16.0, *)
    private var store: ManagedSettingsStore { ManagedSettingsStore(named: ManagedSettingsStore.Name("arete.workout")) }

    @available(iOS 16.0, *)
    private func loadSelection() -> FamilyActivitySelection? {
        guard let data = UserDefaults.standard.data(forKey: Self.selectionKey) else { return nil }
        return try? JSONDecoder().decode(FamilyActivitySelection.self, from: data)
    }

    @available(iOS 16.0, *)
    private func saveSelection(_ s: FamilyActivitySelection) {
        if let data = try? JSONEncoder().encode(s) { UserDefaults.standard.set(data, forKey: Self.selectionKey) }
    }

    @available(iOS 16.0, *)
    private func chosenCount(_ s: FamilyActivitySelection?) -> Int {
        guard let s = s else { return 0 }
        return s.applicationTokens.count + s.webDomainTokens.count + s.categoryTokens.count
    }

    @objc func status(_ call: CAPPluginCall) {
        guard #available(iOS 16.0, *) else { call.resolve(["supported": false]); return }
        let authorized = AuthorizationCenter.shared.authorizationStatus == .approved
        call.resolve([
            "supported": true,
            "authorized": authorized,
            "appsChosen": chosenCount(loadSelection()),
            "locked": UserDefaults.standard.bool(forKey: Self.lockedKey)
        ])
    }

    /// Ask for Screen Time permission, then let the user tick the apps to block. Resolves { appsChosen, cancelled }.
    @objc func setup(_ call: CAPPluginCall) {
        guard #available(iOS 16.0, *) else { call.resolve(["supported": false, "appsChosen": 0]); return }
        Task { @MainActor in
            do {
                try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
            } catch {
                call.resolve(["authorized": false, "appsChosen": 0, "cancelled": true])
                return
            }
            self.presentPicker(call)
        }
    }

    @available(iOS 16.0, *)
    @MainActor
    private func presentPicker(_ call: CAPPluginCall) {
        guard let vc = self.bridge?.viewController else { call.reject("No view to show the picker on"); return }
        var host: UIHostingController<FocusLockPicker>?
        let picker = FocusLockPicker(selection: loadSelection() ?? FamilyActivitySelection()) { [weak self] result in
            host?.dismiss(animated: true)
            guard let self = self else { return }
            if let s = result {
                self.saveSelection(s)
                call.resolve(["authorized": true, "appsChosen": self.chosenCount(s), "cancelled": false])
            } else {
                call.resolve(["authorized": true, "appsChosen": self.chosenCount(self.loadSelection()), "cancelled": true])
            }
        }
        host = UIHostingController(rootView: picker)
        host?.isModalInPresentation = true
        vc.present(host!, animated: true)
    }

    @objc func lock(_ call: CAPPluginCall) {
        guard #available(iOS 16.0, *) else { call.resolve(["locked": false]); return }
        guard AuthorizationCenter.shared.authorizationStatus == .approved, let s = loadSelection(), chosenCount(s) > 0 else {
            call.resolve(["locked": false]); return
        }
        let st = store
        st.shield.applications = s.applicationTokens.isEmpty ? nil : s.applicationTokens
        st.shield.webDomains = s.webDomainTokens.isEmpty ? nil : s.webDomainTokens
        st.shield.applicationCategories = s.categoryTokens.isEmpty ? nil : .specific(s.categoryTokens)
        st.shield.webDomainCategories = s.categoryTokens.isEmpty ? nil : .specific(s.categoryTokens)
        UserDefaults.standard.set(true, forKey: Self.lockedKey)
        call.resolve(["locked": true])
    }

    @objc func unlock(_ call: CAPPluginCall) {
        if #available(iOS 16.0, *) { store.clearAllSettings() }
        UserDefaults.standard.set(false, forKey: Self.lockedKey)
        call.resolve(["locked": false])
    }
}

/// Apple's app picker in a sheet, with Cancel and Done.
@available(iOS 16.0, *)
struct FocusLockPicker: View {
    @State var selection: FamilyActivitySelection
    let done: (FamilyActivitySelection?) -> Void

    var body: some View {
        NavigationView {
            FamilyActivityPicker(selection: $selection)
                .navigationTitle("Lock in")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { done(nil) } }
                    ToolbarItem(placement: .confirmationAction) { Button("Done") { done(selection) } }
                }
        }
    }
}
