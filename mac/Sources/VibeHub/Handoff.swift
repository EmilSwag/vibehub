import Foundation

/// Non-secret server selection handed to the app from outside it — `apiUrl` (the API
/// server, `AppSettings.baseURL`) and `webUrl` (the site, `AppSettings.webUrl`) are two
/// distinct origins, matching `web/public/tracker/connect.sh`'s own `API_URL`/`WEB_URL`
/// split.
///
/// **There is deliberately no `token` here.** Plan FC4 ("both entrances are tokenless"):
/// installing and opening VibeHub carries no credential by either route — the pkg or
/// `curl … | bash` — and the token is entered exactly once, by hand, in native
/// onboarding. A bearer token must never travel in a file an installer wrote, a URL, an
/// environment variable, argv, the process table or shell history. This type therefore
/// carries only which servers to talk to, which is not a secret and is only ever
/// non-default on a staging install.
struct HandoffServers: Equatable {
    let apiUrl: URL?
    let webUrl: URL?

    /// Nothing to adopt — used to discard an empty or token-only drop without making
    /// every call site unwrap an optional twice.
    var isEmpty: Bool { apiUrl == nil && webUrl == nil }
}

/// The two ways *server selection* reaches the app without the user typing it:
///
/// 1. **Installer handoff** — `web/public/tracker/mac.sh` (Cody's lane) writes
///    `~/.vibehub/handoff.json` (mode 0600) only when a non-default server was
///    requested, and omits the file entirely in the normal case. Consumed and deleted
///    on first read, whether or not it turns out to be usable, so a malformed drop
///    can't wedge every future launch into re-reading it.
/// 2. **Deep link** — `vibehub://connect?apiUrl=…&webUrl=…`.
///
/// Both funnel into `AppSettings.adopt(baseURL:webUrl:)`. Neither can authenticate
/// anything: a `token` query item or JSON key is ignored and discarded here rather than
/// forwarded, so an old installer, an old web build or a hand-crafted link cannot
/// reintroduce the withdrawn credential path by accident.
enum Handoff {
    private static var installerFileURL: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".vibehub/handoff.json")
    }

    /// `{ "apiUrl": "...", "webUrl": "..." }` — both optional. Refuses a symlink at the
    /// handoff path before ever reading through it, matching the tracker CLI's own
    /// file-safety posture (`tracker/src/paths.ts`) for a file living in the same
    /// shared, world-navigable `~/.vibehub` directory.
    static func consumeInstallerFile() -> HandoffServers? {
        let url = installerFileURL
        guard let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey]),
              values.isRegularFile == true, values.isSymbolicLink != true else { return nil }

        defer { try? FileManager.default.removeItem(at: url) }
        guard let data = try? Data(contentsOf: url) else { return nil }
        guard let servers = decode(data), !servers.isEmpty else { return nil }
        return servers
    }

    /// `vibehub://connect?apiUrl=...&webUrl=...`. Any `token` query item present is
    /// deliberately not read — see the type doc.
    static func parse(url: URL) -> HandoffServers? {
        guard url.scheme?.lowercased() == "vibehub", url.host?.lowercased() == "connect" else { return nil }
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        func queryURL(_ name: String) -> URL? {
            components.queryItems?.first(where: { $0.name == name })?.value.flatMap(URL.init(string:))
        }
        let servers = HandoffServers(apiUrl: queryURL("apiUrl"), webUrl: queryURL("webUrl"))
        return servers.isEmpty ? nil : servers
    }

    /// `Wire` has no `token` member at all, so a JSON file containing one decodes
    /// successfully *without* it — unknown keys are ignored by `Decodable` synthesis.
    /// That is the intended behaviour: an installer from before FC4 degrades to
    /// server-selection-only rather than failing, and its token is never materialised.
    private static func decode(_ data: Data) -> HandoffServers? {
        struct Wire: Decodable { let apiUrl: String?; let webUrl: String? }
        guard let wire = try? JSONDecoder().decode(Wire.self, from: data) else { return nil }
        return HandoffServers(
            apiUrl: wire.apiUrl.flatMap(URL.init(string:)),
            webUrl: wire.webUrl.flatMap(URL.init(string:))
        )
    }
}
