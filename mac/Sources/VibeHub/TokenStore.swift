import Foundation

/// The tracker token, held in memory. Its single source of truth is the tracker's own
/// `~/.vibehub/config.json` (`deviceToken`) — written by the embedded CLI's `login`
/// (`TrackerManager.connect`) and removed by its `logout` (sign out). The app no longer
/// keeps a second copy anywhere.
///
/// Nothing here touches disk or the Keychain on the main thread: `load()` resolves the
/// token once, off-main, at launch; everything after that is an in-memory read.
///
/// Legacy: a 1.2.1-or-older install whose config.json is missing but whose Keychain item exists is
/// read **once** (never prompting — `Keychain.readLegacyToken`) and then migrated into
/// config.json by `TrackerManager.migrateLegacyTokenIfNeeded`. Once config.json has held a
/// token, or the user signs out, the Keychain is never consulted again (`legacyRetiredKey`)
/// — otherwise a signed-out Mac would quietly sign itself back in from the old item.
@MainActor
final class TokenStore {
    static let shared = TokenStore()

    enum Source: Equatable {
        case none
        case config
        case legacyKeychain
    }

    static let legacyRetiredKey = "LegacyKeychainRetired"

    private var storedToken: String?
    private(set) var source: Source = .none
    /// False until the launch read has finished. `StatusStore` shows loading, not
    /// "sign in", until then.
    private(set) var isLoaded = false
    private var hasLoaded = false
    private let defaults: UserDefaults
    private let configURL: URL

    init(defaults: UserDefaults = .standard, configURL: URL = TokenStore.defaultConfigURL) {
        self.defaults = defaults
        self.configURL = configURL
    }

    nonisolated static var defaultConfigURL: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".vibehub/config.json")
    }

    var token: String? {
        #if DEBUG
        if let fixture = Keychain.fixtureToken { return fixture }
        #endif
        return storedToken
    }

    /// Once per process: config.json first, then (only if not retired) the legacy item.
    func load() async {
        #if DEBUG
        if Keychain.fixtureToken != nil { isLoaded = true; return }
        #endif
        guard !hasLoaded else { return }
        hasLoaded = true
        let allowLegacy = !defaults.bool(forKey: Self.legacyRetiredKey)
        let url = configURL
        let resolved = await Task.detached(priority: .userInitiated) {
            Self.resolve(configURL: url, allowLegacy: allowLegacy)
        }.value
        storedToken = resolved.token
        source = resolved.source
        if resolved.source == .config { defaults.set(true, forKey: Self.legacyRetiredKey) }
        isLoaded = true
    }

    /// Blocking; off-main only. Pure apart from the reads, so the QA harness can drive it.
    nonisolated static func resolve(configURL: URL, allowLegacy: Bool,
                                    legacyService: String = Keychain.service) -> (token: String?, source: Source) {
        if let token = readConfigToken(at: configURL) { return (token, .config) }
        guard allowLegacy, let token = Keychain.readLegacyToken(service: legacyService).token else { return (nil, .none) }
        return (token, .legacyKeychain)
    }

    nonisolated static func readConfigToken(at url: URL) -> String? {
        guard let data = try? Data(contentsOf: url),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let token = (object["deviceToken"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
              !token.isEmpty else { return nil }
        return token
    }

    /// A verified `login` just wrote this token into config.json.
    func adopt(_ token: String) {
        storedToken = token
        source = .config
        isLoaded = true
        defaults.set(true, forKey: Self.legacyRetiredKey)
    }

    /// Sign out: `logout` removed config.json. The legacy item is left untouched but
    /// retired, so it can never sign this Mac back in.
    func clear() {
        storedToken = nil
        source = .none
        defaults.set(true, forKey: Self.legacyRetiredKey)
    }
}
