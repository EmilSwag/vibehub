import Darwin
import Foundation
import Security

/// **Legacy, read-only.** Builds up to 1.2.1 kept the tracker token in the login Keychain
/// (`com.vibehub.menubar` / `tracker-token`). The token now lives in exactly one place —
/// the tracker's own `~/.vibehub/config.json` (`TokenStore`) — and this item is consulted
/// at most once per launch, only when that file has no token, to migrate an old install.
///
/// Why it's no longer the store: a Keychain item's ACL names the app that created it. A
/// differently-signed upgrade reading it raises an "allow access" prompt, and
/// `SecItemCopyMatching` blocks until someone answers — which froze 1.2.1 on the main
/// thread. So the read here never shows UI: an item this build isn't allowed to read is
/// treated as "no token", and the user reconnects with one click. Nothing here ever writes
/// or deletes the item.
///
/// Measured (`--qa-keychain`, 2026-09-26): `kSecUseAuthenticationUISkip` alone does **not**
/// suppress the legacy login-keychain ACL dialog — the read still blocked on it. So the read
/// also turns the file-keychain switch `SecKeychainSetUserInteractionAllowed(false)` off
/// around this one call and restores it after. That function is still exported by Security
/// but gone from the macOS 26 SDK headers (deprecated in older ones), so it's resolved at
/// runtime; if it can't be, the legacy read is skipped — never risk a prompt.
enum Keychain {
    static let service = "com.vibehub.menubar"
    static let account = "tracker-token"

    #if DEBUG
    /// QA harness only (`QAHarness`): when set, `TokenStore` answers from here and never
    /// reads config.json or the Keychain — fixtures must never see a real credential.
    static var fixtureToken: String??
    #endif

    enum LegacyRead: Equatable {
        case token(String)
        /// No item (or an empty one).
        case none
        /// The item exists but this build may not read it without a prompt — treated
        /// exactly like `none` by callers. Carries the OSStatus for logs/QA.
        case notAllowed(OSStatus)

        var token: String? {
            if case .token(let value) = self { return value }
            return nil
        }
    }

    /// Blocking Security call — never on the main thread (asserted). Never prompts.
    static func readLegacyToken(service: String = Keychain.service, account: String = Keychain.account) -> LegacyRead {
        assert(!Thread.isMainThread, "Keychain reads must stay off the main thread")
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
            // No "allow access" dialog, ever: an item that would need one comes back as
            // not-allowed / not-found instead of blocking this thread on a human.
            kSecUseAuthenticationUI as String: kSecUseAuthenticationUISkip,
        ]
        var item: CFTypeRef?
        guard let status = withKeychainUserInteractionDisabled({
            SecItemCopyMatching(query as CFDictionary, &item)
        }) else { return .notAllowed(errSecInteractionNotAllowed) }
        switch status {
        case errSecSuccess:
            guard let data = item as? Data,
                  let token = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !token.isEmpty else { return .none }
            return .token(token)
        case errSecItemNotFound:
            return .none
        default:
            // errSecInteractionNotAllowed, errSecAuthFailed, … — all mean "not without a prompt".
            return .notAllowed(status)
        }
    }

    // MARK: - Legacy keychain UI switch

    private typealias SetInteraction = @convention(c) (UInt8) -> OSStatus
    private typealias GetInteraction = @convention(c) (UnsafeMutablePointer<UInt8>) -> OSStatus
    /// The switch is process-wide; serialise the save/disable/restore dance.
    private static let interactionLock = NSLock()

    private static func symbol<T>(_ name: String, as _: T.Type) -> T? {
        // RTLD_DEFAULT: Security is already linked into this process.
        guard let pointer = dlsym(UnsafeMutableRawPointer(bitPattern: -2), name) else { return nil }
        return unsafeBitCast(pointer, to: T.self)
    }

    /// Runs `body` with file-keychain user interaction off, restoring the previous state.
    /// Nil (body not run) when the switch can't be resolved — no switch, no read.
    private static func withKeychainUserInteractionDisabled<T>(_ body: () -> T) -> T? {
        guard let set = symbol("SecKeychainSetUserInteractionAllowed", as: SetInteraction.self),
              let get = symbol("SecKeychainGetUserInteractionAllowed", as: GetInteraction.self) else { return nil }
        interactionLock.lock()
        defer { interactionLock.unlock() }
        var previous: UInt8 = 1
        _ = get(&previous)
        _ = set(0)
        defer { _ = set(previous) }
        return body()
    }
}
