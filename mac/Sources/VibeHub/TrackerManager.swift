import Combine
import Darwin
import Foundation

enum TrackerManagerError: LocalizedError, Equatable {
    case noToken
    case bundleMissing
    case notInApplications
    case processFailed(String)
    case launchAgentFailed(String)

    var errorDescription: String? {
        switch self {
        case .noToken: return "No tracker token to start tracking with."
        case .bundleMissing: return "The bundled tracker is missing from this build."
        case .notInApplications: return "Move VibeHub to your Applications folder first, then start tracking."
        case .processFailed(let detail): return detail
        case .launchAgentFailed(let detail): return detail
        }
    }
}

/// Drives the Start-tracking step's progress ticks + inline retry. `.failed` carries
/// its own message so the UI doesn't have to cross-reference `lastActionError`.
enum TrackAtLoginProgress: Equatable {
    case idle
    case signingIn
    case startingTracker
    case done
    case failed(String)
}

/// Mirrors the tracker CLI's `StatusFile` (`tracker/src/types.ts`) as read straight off
/// `~/.vibehub/status.json` — local truth about the daemon on *this* machine, which is
/// not the same thing as `TrackerMe.tracker.connected` (a fact about the server's last
/// accepted heartbeat, possibly from a different device). Every field here is optional
/// or has a safe fallback so a status.json from an older or newer tracker build still
/// decodes.
struct LocalTrackerStatus: Decodable {
    struct Source: Decodable {
        let tool: String
        let model: String?
        let lastSeenAt: String
    }

    let status: String
    let projectAlias: String?
    let tool: String?
    let model: String?
    let updatedAt: String
    /// FC2: the result of the daemon's accepted **connection-v1 receipt** — a transport
    /// fact, not AI activity. `tracker/src/types.ts` documents it in exactly those
    /// words. Never render this as "working"; see `connectionState` below.
    let connected: Bool?
    /// Server time from a validated connection-v1 receipt, kept separate from anything
    /// AI-derived.
    let lastConnectionSeenAt: String?
    /// When the daemon last *attempted* the bodyless connection poll.
    let lastConnectionCheckAt: String?
    /// Digest of the local config. A snapshot whose fingerprint belongs to a previous
    /// account must not be trusted as this one's (FC5, "clear the old account").
    let configFingerprint: String?
    /// Local provenance marker; a legacy snapshot without one cannot be forwarded.
    let collectionPolicy: String?
    let authRejected: Bool?
    let sources: [Source]?
}

/// FC2's idle-freshness rule, as three states the UI can render without ever conflating
/// them. The plan is explicit that "Connected" and "Active" are two different things and
/// that a transport tick must never present as AI usage.
enum TrackerConnectionState: Equatable {
    /// No live daemon, or a snapshot too old to believe.
    case unknown
    /// A fresh connection-v1 receipt: the daemon is reaching the server. Says nothing
    /// about whether any AI tool is in use.
    case connected
    /// Daemon alive and fresh, but the server is not accepting its connection.
    case disconnected
    /// The server rejected the token (401). Nothing resumes without a new verified login.
    case authRejected
}

/// Runs the embedded tracker CLI off the main actor: `Process.waitUntilExit()` blocks
/// its calling thread, and `login`/a cold-starting embedded Node can take a few seconds.
private struct TrackerProcess {
    let output: String
    let exitCode: Int32

    /// `stdin`, when given, is written to the child's standard input and the pipe is
    /// then closed. This is how the token reaches the CLI (FC4: "no token in argv") —
    /// `ProcessInfo`/`ps` expose a process's arguments to any local user, but never its
    /// stdin. The write happens before the output drain below, and the data involved is
    /// a single short line, so it cannot fill the pipe buffer and deadlock.
    static func run(node: URL, arguments: [String], timeout: TimeInterval, stdin: String? = nil) async -> TrackerProcess {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .utility).async {
                let process = Process()
                process.executableURL = node
                process.arguments = arguments
                let pipe = Pipe()
                process.standardOutput = pipe
                process.standardError = pipe
                let input = stdin.map { _ in Pipe() }
                if let input { process.standardInput = input }

                let timeoutWorkItem = DispatchWorkItem { if process.isRunning { process.terminate() } }
                DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: timeoutWorkItem)

                do {
                    try process.run()
                } catch {
                    timeoutWorkItem.cancel()
                    continuation.resume(returning: TrackerProcess(
                        output: "Could not launch the embedded tracker: \(error.localizedDescription)",
                        exitCode: -1
                    ))
                    return
                }
                // Hand over stdin first and close it, so a CLI blocking on a read of
                // its token line gets one and proceeds instead of hanging to timeout.
                if let input, let stdin {
                    input.fileHandleForWriting.write(Data(stdin.utf8))
                    try? input.fileHandleForWriting.close()
                }
                // Read before waiting: a child that fills the pipe buffer before this
                // process calls waitUntilExit() would otherwise deadlock both sides.
                let data = pipe.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit()
                timeoutWorkItem.cancel()
                continuation.resume(returning: TrackerProcess(
                    output: String(data: data, encoding: .utf8) ?? "",
                    exitCode: process.terminationStatus
                ))
            }
        }
    }
}

/// Owns the tracker the app ships: the embedded Node runtime + `vibehub-tracker.cjs`
/// (`scripts/bundle.sh` embeds both into `Contents/Resources/tracker/`), the
/// `com.vibehub.tracker` LaunchAgent that keeps it running across logins and restarts
/// it if it dies, and the local `~/.vibehub/status.json` / `tracker.pid` this class
/// reads back so the popover can show real local state independent of whether the
/// *server* has seen a recent heartbeat.
@MainActor
final class TrackerManager: ObservableObject {
    @Published private(set) var isRunning = false
    /// When this app last (re)started the LaunchAgent job. A freshly installed Node takes
    /// ~20 s to launch (macOS scans the new binary) before the daemon writes its pid file;
    /// live QA 2026-09-26 showed "Not counting" for that whole window after every upgrade.
    @Published private(set) var agentStartedAt: Date?
    /// The job was just (re)started and its pid isn't up yet: "Starting…", not "Not counting".
    var isStarting: Bool {
        guard !isRunning, isTrackAtLoginEnabled, let started = agentStartedAt else { return false }
        return Date().timeIntervalSince(started) < 60
    }
    @Published private(set) var isTrackAtLoginEnabled: Bool
    @Published private(set) var localStatus: LocalTrackerStatus?
    @Published private(set) var lastActionError: String?
    @Published private(set) var isBusy = false
    /// Set on every successful `connect(token:apiUrl:webUrl:)` — the one signal every
    /// token source (pasted, `vibehub://connect`, installer handoff) raises the same
    /// way, so `OnboardingWizard` can auto-advance regardless of which one fired.
    @Published private(set) var connectedUsername: String?
    @Published private(set) var startProgress: TrackAtLoginProgress = .idle
    /// N7: why the app's own login registration could not be set, if it could not.
    /// Surfaced next to the one switch that owns both halves, instead of leaving a
    /// toggle silently disagreeing with what the system actually does.
    @Published private(set) var launchAtLoginError: String?

    private let settings: AppSettings
    private let launchAgent = LaunchAgent()
    private var pollTask: Task<Void, Never>?

    nonisolated private static let vibehubDirectory = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(".vibehub")
    nonisolated private static let statusPath = vibehubDirectory.appendingPathComponent("status.json")
    nonisolated private static let pidPath = vibehubDirectory.appendingPathComponent("tracker.pid")
    private static let statusPollInterval: Duration = .seconds(5)

    init(settings: AppSettings) {
        self.settings = settings
        isTrackAtLoginEnabled = launchAgent.isInstalled
    }

    #if DEBUG
    /// QA harness only. A fixture tracker never reads `~/.vibehub`, never runs the
    /// embedded CLI and never touches launchd or `SMAppService` — every mutating entry
    /// point below refuses while this is set, so a click in a live QA window is inert.
    private(set) var isFixture = false

    convenience init(settings: AppSettings, fixtureRunning: Bool, trackAtLogin: Bool, status: LocalTrackerStatus?) {
        self.init(settings: settings)
        isFixture = true
        isRunning = fixtureRunning
        isTrackAtLoginEnabled = trackAtLogin
        localStatus = status
    }
    #endif

    var embeddedNodeURL: URL? {
        Bundle.main.resourceURL?.appendingPathComponent("tracker/node/bin/node")
    }

    var embeddedCjsURL: URL? {
        Bundle.main.resourceURL?.appendingPathComponent("tracker/vibehub-tracker.cjs")
    }

    /// `false` only in a dev build assembled by hand without `scripts/bundle.sh` —
    /// every shipped build (CI, `make-pkg.sh`) embeds both.
    var hasEmbeddedTracker: Bool {
        guard let node = embeddedNodeURL, let cjs = embeddedCjsURL else { return false }
        return FileManager.default.isExecutableFile(atPath: node.path) && FileManager.default.fileExists(atPath: cjs.path)
    }

    /// The one path every token source shares — pasted (`OnboardingView`),
    /// `vibehub://connect` (`AppDelegate`), or the installer's `handoff.json`
    /// (`VibeHubApp.init`) — so "verify against the server, then save" happens exactly
    /// once, the same way, no matter which one fired. Verify-first, not save-first:
    /// the app only adopts the token (`TokenStore`) once `login` has confirmed it and
    /// written config.json, so a bad paste never replaces a working token in the UI. A non-default `apiUrl`/`webUrl` persists into `AppSettings` immediately,
    /// before the verification call — `login` itself needs the (possibly just-updated)
    /// server to call.
    @discardableResult
    func connect(token: String, apiUrl: URL? = nil, webUrl: URL? = nil) async -> Result<String, TrackerManagerError> {
        #if DEBUG
        if isFixture { return .failure(.processFailed("QA fixture: disabled.")) }
        #endif
        settings.adopt(baseURL: apiUrl, webUrl: webUrl)

        // FC5, "clear the old account before restarting". If a *different* credential is
        // arriving while a daemon is running, the previous account must be retired
        // first: its device-scoped transport receipt released, its session closed, its
        // local state dropped. Doing this before `login` means the new token is never
        // written on top of a live previous-account daemon, and no restart can reuse the
        // old account's receipt, session or cached status.
        let replacingExistingToken = TokenStore.shared.token.map { $0 != token } ?? false
        let agentWasInstalled = launchAgent.isInstalled
        if replacingExistingToken {
            // Supervisor first. With the agent still bootstrapped, the `stop` inside
            // `retireCurrentAccount` makes `serve` exit, and launchd could relaunch it
            // into the window between `logout` (config gone) and the new `login` (config
            // back) — a 30s-throttled fail loop, harmless but pointless, and a daemon
            // briefly running on nothing. Boot it out here, retire the account, and
            // reinstall below once the new login has succeeded. `install` rewrites the
            // plist from scratch, so nothing is lost by removing it now.
            if agentWasInstalled {
                let agent = launchAgent
                try? await Task.detached { try agent.uninstall() }.value
                isTrackAtLoginEnabled = launchAgent.isInstalled
            }
            await retireCurrentAccount()
        }

        let result = await login(token: token)
        guard case .success(let username) = result else {
            // The previous account is already retired and its supervisor, if any, is
            // down — there is no config for it to serve. That is the honest state: the
            // popover's tracker row offers "Start tracking" again once a login works.
            return result
        }
        // `login` just wrote it into config.json — the one place the token lives.
        TokenStore.shared.adopt(token)
        connectedUsername = username

        // N1(a): a running supervisor was executing against the config that `login`
        // just rewrote — or was booted out above to make room for the new account.
        // Either way, (re)install it through the same path that installed it, so
        // `serve` starts on the new `config.json` immediately instead of "happening to
        // notice" later. Skipped when tracking was never on, and when the user has
        // tracking off — connecting an account must not quietly start tracking (FC5,
        // retained Off).
        if agentWasInstalled && !settings.userDisabledTracking {
            await restartAgent()
        }
        refreshLocalStatus()
        return result
    }

    /// Step (1)–(3) of FC5's account-change order. Best-effort throughout: this runs
    /// while swapping credentials, and a daemon that is already gone, already stopped,
    /// or never existed is the desired end state either way — there is nothing to
    /// surface to the user and nothing that should block the new login.
    private func retireCurrentAccount() async {
        guard let node = embeddedNodeURL, let cjs = embeddedCjsURL else { return }
        // (1)+(2) `stop` closes the open session and releases the device-scoped
        // connection-v1 receipt via the CLI's own bounded bodyless DELETE — the app
        // never speaks that protocol itself, so the one implementation stays in the
        // collector where the contract is pinned.
        _ = await TrackerProcess.run(node: node, arguments: [cjs.path, "stop"], timeout: 15)
        // (3) Drop this account's credential from the tracker's own store, so a daemon
        // restarted by any route cannot come back up on it.
        _ = await TrackerProcess.run(node: node, arguments: [cjs.path, "logout"], timeout: 15)
        // A snapshot written by the previous account must not be read as this one's.
        localStatus = nil
        connectedUsername = nil
    }

    /// N1(b): the explicit Sign out that clearing a text field never was. Order matters —
    /// tear the supervisor down *before* dropping credentials, or launchd relaunches a
    /// daemon into a half-cleared state between the two steps.
    func signOut() async {
        #if DEBUG
        if isFixture { return }
        #endif
        isBusy = true
        defer { isBusy = false }
        let agent = launchAgent
        try? await Task.detached { try agent.uninstall() }.value
        launchAtLoginError = await settings.setLaunchAtLogin(false)
        await retireCurrentAccount()
        // `logout` (in retireCurrentAccount) removed config.json. The legacy Keychain
        // item is never deleted — only retired, so it can't sign this Mac back in.
        TokenStore.shared.clear()
        settings.userDisabledTracking = true
        isTrackAtLoginEnabled = launchAgent.isInstalled
        startProgress = .idle
        lastActionError = nil
        refreshLocalStatus()
    }

    /// Rewrites the plist from this bundle's *current* paths and forces a fresh start.
    /// Used by an account change (N1) and by the upgrade reconcile (N2) — both need the
    /// running job replaced, not merely signalled.
    /// Returns true when the job is running on this bundle's binaries afterwards.
    @discardableResult
    private func restartAgent() async -> Bool {
        guard let node = embeddedNodeURL, let cjs = embeddedCjsURL else { return false }
        let agent = launchAgent
        let nodePath = node.path
        let cjsPath = cjs.path
        defer { isTrackAtLoginEnabled = launchAgent.isInstalled }
        do {
            // Off-main: `install` polls launchd and backs off with blocking sleeps.
            _ = try await Task.detached { try agent.install(nodePath: nodePath, cjsPath: cjsPath) }.value
            lastActionError = nil
            agentStartedAt = Date()
            return true
        } catch {
            lastActionError = error.localizedDescription
            return false
        }
    }

    /// ≤1.2.1 → 1.2.2: a token found only in the legacy Keychain item is written into
    /// config.json through the CLI's verified `login` (off-main process, token on stdin).
    /// On failure (offline, rejected) the in-memory token still works this launch and the
    /// migration is tried again next launch; the Keychain item is never touched.
    func migrateLegacyTokenIfNeeded() async {
        #if DEBUG
        if isFixture { return }
        #endif
        guard TokenStore.shared.source == .legacyKeychain, let token = TokenStore.shared.token,
              hasEmbeddedTracker else { return }
        if case .success = await login(token: token) {
            TokenStore.shared.adopt(token)
            refreshLocalStatus()
        }
    }

    /// "Name it" for a Private project: maps a local folder name to the name friends
    /// see (`vibehub-tracker set <folder> <alias>`), then restarts a running tracker so
    /// the next heartbeat carries it. Nothing leaves the Mac except the chosen name.
    func nameProject(folder: String, as alias: String) async -> Result<Void, TrackerManagerError> {
        #if DEBUG
        if isFixture { return .failure(.processFailed("QA fixture: disabled.")) }
        #endif
        let folder = folder.trimmingCharacters(in: .whitespacesAndNewlines)
        let alias = alias.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !folder.isEmpty, !alias.isEmpty else { return .failure(.processFailed("Type a folder name.")) }
        guard let node = embeddedNodeURL, let cjs = embeddedCjsURL else { return .failure(.bundleMissing) }
        isBusy = true
        defer { isBusy = false }
        let result = await TrackerProcess.run(node: node, arguments: [cjs.path, "set", folder, alias], timeout: 15)
        guard result.exitCode == 0 else {
            let message = result.output.trimmingCharacters(in: .whitespacesAndNewlines)
            return .failure(.processFailed(message.isEmpty ? "Couldn\u{2019}t save that name." : message))
        }
        if launchAgent.isInstalled && !settings.userDisabledTracking {
            await restartAgent()
        }
        return .success(())
    }

    /// Writes the tracker's own `~/.vibehub/config.json` — the token's single source of
    /// truth since 1.2.2 (`TokenStore`), and the file the embedded daemon reads.
    ///
    /// Success is strict on purpose: exit 0 *and* a stdout line starting with
    /// "Logged in as " (`tracker/src/index.ts`'s `verified.ok` branch, whose returned
    /// `@username` this parses out and returns) — not merely exit 0, since the CLI
    /// still exits 0 and prints "Wrote ..." when it saved the config without being
    /// able to verify the token against the server. That unverified-but-saved case
    /// must not read as success here: `connect` only adopts the token on this
    /// result, and "Start tracking" bootstraps a LaunchAgent on the strength of it — a
    /// silently-invalid token would just launchd-loop the daemon forever with no
    /// visible symptom until the popover's own status row happens to be checked.
    @discardableResult
    func login(token: String, apiUrl: URL? = nil) async -> Result<String, TrackerManagerError> {
        #if DEBUG
        if isFixture { return .failure(.processFailed("QA fixture: disabled.")) }
        #endif
        guard let node = embeddedNodeURL, let cjs = embeddedCjsURL else {
            lastActionError = TrackerManagerError.bundleMissing.errorDescription
            return .failure(.bundleMissing)
        }
        let url = apiUrl ?? settings.baseURL
        // FC4, "no token in argv": the token goes down stdin, never into `arguments`.
        // A process's argument vector is readable by any local user (`ps -ww`), its
        // stdin is not. `--token-stdin` is the tracker CLI's flag for this (Cody's lane,
        // `tracker/src/index.ts`); the positional form it replaces remains only for the
        // untouched Windows/Linux CLI. This app never uses it — there is no fallback to
        // argv, by contract.
        //
        // Cross-lane state, verified read-only on 2026-09-21: `tracker/src/index.ts`
        // still declares only `login <deviceToken>`; the flag is not landed yet. Against
        // that CLI this call fails with commander's usage error, which
        // `indicatesMissingStdinLogin` turns into a message that names the cause.
        // CI's "Verify embedded tracker contract" step refuses to ship such a bundle.
        let result = await TrackerProcess.run(
            node: node,
            arguments: [cjs.path, "login", "--token-stdin", "--api-url", url.absoluteString],
            timeout: 30,
            stdin: token + "\n"
        )
        let confirmedPrefix = "Logged in as "
        let confirmedLine = result.output
            .split(separator: "\n", omittingEmptySubsequences: true)
            .first { $0.hasPrefix(confirmedPrefix) }
        guard result.exitCode == 0, let confirmedLine else {
            let trimmed = result.output.trimmingCharacters(in: .whitespacesAndNewlines)
            let message: String
            if Self.indicatesMissingStdinLogin(trimmed) {
                message = "This build's bundled tracker predates stdin login, so VibeHub cannot sign in. Rebuild with a current tracker bundle."
            } else {
                message = trimmed.isEmpty ? "The embedded tracker did not confirm the login." : trimmed
            }
            lastActionError = message
            return .failure(.processFailed(message))
        }
        lastActionError = nil
        let username = confirmedLine.dropFirst(confirmedPrefix.count).trimmingCharacters(in: .whitespaces)
        return .success(username)
    }

    /// commander's two ways of rejecting `login --token-stdin` against the old
    /// `login <deviceToken>` signature: the flag is unknown, or the positional argument
    /// the stdin form replaces is reported missing. Neither output contains the token —
    /// the CLI never echoes it — so surfacing the mapped message is safe.
    private static func indicatesMissingStdinLogin(_ output: String) -> Bool {
        output.contains("unknown option '--token-stdin'") || output.contains("missing required argument 'deviceToken'")
    }

    /// The one "Start tracking" action: (re)runs `login` with the current token so
    /// the tracker's own `~/.vibehub/config.json` is current, then writes + bootstraps
    /// the LaunchAgent — which (via `RunAtLoad`) also starts the tracker immediately,
    /// no separate `start` call needed. Skipping the `login` step would let the
    /// LaunchAgent bootstrap a daemon with no config, which `serve` (like every other
    /// tracker command) refuses to run with — see `requireConfig()` in
    /// `tracker/src/config.ts`.
    ///
    /// Depends on the tracker CLI's hidden `serve` command (plan lane B,
    /// `tracker/**`): a foreground loop that owns the pid file directly and exits 0 if
    /// a healthy daemon is already running, so launchd's restart cycle is a cheap
    /// no-op rather than a fight over `tracker.pid`.
    func enableTrackAtLogin() async -> Result<Void, TrackerManagerError> {
        #if DEBUG
        if isFixture { return .failure(.processFailed("QA fixture: disabled.")) }
        #endif
        guard let token = TokenStore.shared.token else {
            lastActionError = TrackerManagerError.noToken.errorDescription
            startProgress = .failed(TrackerManagerError.noToken.errorDescription ?? "")
            return .failure(.noToken)
        }
        guard let node = embeddedNodeURL, let cjs = embeddedCjsURL else {
            lastActionError = TrackerManagerError.bundleMissing.errorDescription
            startProgress = .failed(TrackerManagerError.bundleMissing.errorDescription ?? "")
            return .failure(.bundleMissing)
        }
        // N3: the plist records this bundle's absolute paths. A second copy running from
        // ~/Downloads would rewrite the same `com.vibehub.tracker` label to point at
        // itself, and the moment that copy is deleted or moved the LaunchAgent starts
        // failing with no visible cause. Refuse before writing anything, and say what to
        // do about it — `SMAppService.register()` (N7) has the same requirement, so this
        // check keeps both halves of "Start" honest instead of half-enabling.
        guard Self.isInApplicationsFolder else {
            let message = TrackerManagerError.notInApplications.errorDescription ?? ""
            lastActionError = message
            startProgress = .failed(message)
            return .failure(.notInApplications)
        }
        isBusy = true
        defer { isBusy = false }

        startProgress = .signingIn
        if case .failure(let error) = await login(token: token) {
            startProgress = .failed(error.errorDescription ?? "Could not sign in.")
            return .failure(error)
        }

        startProgress = .startingTracker
        let agent = launchAgent
        let nodePath = node.path
        let cjsPath = cjs.path
        do {
            _ = try await Task.detached { try agent.install(nodePath: nodePath, cjsPath: cjsPath) }.value
        } catch {
            lastActionError = error.localizedDescription
            isTrackAtLoginEnabled = launchAgent.isInstalled
            startProgress = .failed(error.localizedDescription)
            return .failure(.launchAgentFailed(error.localizedDescription))
        }
        lastActionError = nil
        agentStartedAt = Date()
        isTrackAtLoginEnabled = launchAgent.isInstalled
        // N7: the daemon comes back at login via `RunAtLoad`; the app has to be asked
        // separately, and the menu bar / Island are the product's only UI — a machine
        // that reboots into a running tracker with no way to see it is not "started".
        // Both halves are installed by this one approved action (FC5, "re-login").
        launchAtLoginError = await settings.setLaunchAtLogin(true)
        // FC5, retained Off: an explicit Start is the only thing that clears the opt-out.
        settings.userDisabledTracking = false
        refreshLocalStatus()
        startProgress = .done
        return .success(())
    }

    /// Bootout + remove the plist (`LaunchAgent.uninstall`), then best-effort `stop` the
    /// CLI directly — the LaunchAgent teardown alone stops launchd from *relaunching*
    /// the daemon, but doesn't ask an already-running one to shut down cleanly (close
    /// its open session, write `status.json` back to offline). `stop`'s own failure
    /// doesn't fail this call: the LaunchAgent is already gone either way, which is the
    /// primary thing "disable" means.
    func disableTrackAtLogin() async -> Result<Void, TrackerManagerError> {
        #if DEBUG
        if isFixture { return .failure(.processFailed("QA fixture: disabled.")) }
        #endif
        isBusy = true
        defer { isBusy = false }
        let agent = launchAgent
        do {
            try await Task.detached { try agent.uninstall() }.value
        } catch {
            lastActionError = error.localizedDescription
            isTrackAtLoginEnabled = launchAgent.isInstalled
            return .failure(.launchAgentFailed(error.localizedDescription))
        }
        if let node = embeddedNodeURL, let cjs = embeddedCjsURL {
            _ = await TrackerProcess.run(node: node, arguments: [cjs.path, "stop"], timeout: 15)
        }
        lastActionError = nil
        isTrackAtLoginEnabled = launchAgent.isInstalled
        // FC5, "Pause is Off — there is no third state": stopping is always the durable
        // choice. The app's own login registration goes with it, and the flag is what
        // stops `reconcileOnLaunch` (and any future helpful restore) from undoing this
        // at the next login, upgrade or reinstall.
        launchAtLoginError = await settings.setLaunchAtLogin(false)
        settings.userDisabledTracking = true
        startProgress = .idle
        refreshLocalStatus()
        return .success(())
    }

    /// Runs once per launch, from `VibeHubApp.init()`. Two jobs, in this order:
    ///
    /// 1. **Retained Off wins.** If the user turned tracking off but a LaunchAgent is
    ///    somehow present — a pkg reinstall that re-ran an old plist, a restored backup,
    ///    a second copy of the app — it is torn down rather than adopted. An opt-out that
    ///    an upgrade can quietly reverse is not an opt-out.
    /// 2. **Upgrade repair.** A pkg upgrade replaces the embedded node/cjs *underneath*
    ///    the running job, whose `ProgramArguments` still reference the replaced inodes.
    ///    When the bundle version has changed since the last launch and tracking is on,
    ///    rewrite the plist from this bundle's current paths and force a fresh start.
    ///
    /// The version marker is written afterwards either way, so a launch that could not
    /// repair (no embedded tracker in a dev build) retries next time instead of
    /// recording success it did not achieve.
    func reconcileOnLaunch() async {
        #if DEBUG
        if isFixture { return }
        #endif
        // The version marker is written only once this launch's reconcile is settled:
        // nothing to do, or the restart onto the new binaries actually succeeded. A
        // failed restart leaves the old marker so the next launch tries again, instead
        // of recording "upgraded" over a job still running replaced binaries.
        if settings.userDisabledTracking {
            if launchAgent.isInstalled {
                let agent = launchAgent
                try? await Task.detached { try agent.uninstall() }.value
                isTrackAtLoginEnabled = launchAgent.isInstalled
            }
            settings.recordCurrentBundleVersion()
            return
        }

        guard launchAgent.isInstalled, hasEmbeddedTracker,
              let current = settings.currentBundleVersion,
              settings.lastRunBundleVersion != current else {
            settings.recordCurrentBundleVersion()
            return
        }
        let restarted = await restartAgent()
        refreshLocalStatus()
        if restarted { settings.recordCurrentBundleVersion() }
    }

    /// FC5, "auth-invalid halts the daemon itself". The collector is the authority here —
    /// it stops reads, heartbeats and connection polls on a 401 and exits 0 so launchd's
    /// failure-only KeepAlive leaves it down, with the app closed or not. This is the
    /// app-side half: when it *is* open, take the supervisor down too so launchd cannot
    /// resurrect a daemon that can never authenticate, and leave a state the UI can
    /// explain. Nothing here retries; only a new verified `connect` restores tracking.
    private func handleAuthRejectionIfNeeded() {
        guard localStatus?.authRejected == true, launchAgent.isInstalled else { return }
        // Self-limiting: once the agent is gone the guard above stops this from firing
        // again on the next 5s poll, so a persistent rejection costs exactly one teardown.
        let agent = launchAgent
        Task {
            try? await Task.detached { try agent.uninstall() }.value
            self.isTrackAtLoginEnabled = agent.isInstalled
            self.lastActionError = "VibeHub couldn't sign in with the saved token. Reconnect this Mac to start tracking again."
        }
    }

    /// Every 5s: two small local file reads, no subprocess. Started once at launch
    /// (`VibeHubApp.init()`); also called directly (via `refreshLocalStatus()`) right
    /// after any action above and on popover `onAppear`, so the UI never waits a full
    /// interval to reflect something the user just did.
    func startPolling() {
        #if DEBUG
        if isFixture { return }
        #endif
        guard pollTask == nil else { return }
        refreshLocalStatus()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: Self.statusPollInterval)
                guard let self, !Task.isCancelled else { return }
                self.refreshLocalStatus()
            }
        }
    }

    func stopPolling() {
        pollTask?.cancel()
        pollTask = nil
    }

    /// Every 5s and after actions. The three file reads + `kill(pid, 0)` run off-main;
    /// only the assignment hops back.
    func refreshLocalStatus() {
        #if DEBUG
        if isFixture { return }
        #endif
        let agent = launchAgent
        Task {
            let snapshot = await Task.detached(priority: .utility) {
                (installed: agent.isInstalled,
                 status: Self.readStatus(),
                 running: Self.readRunningPid().map(Self.isProcessAlive) ?? false)
            }.value
            isTrackAtLoginEnabled = snapshot.installed
            localStatus = snapshot.status
            isRunning = snapshot.running
            handleAuthRejectionIfNeeded()
        }
    }

    /// FC2's freshness bound. The collector's transport TTL is 90s for 30s ticks, so a
    /// snapshot older than that describes a daemon that has stopped reporting — and a
    /// snapshot with no live pid behind it describes one that is simply gone. Either way
    /// the honest rendering is "unknown", never the last thing it happened to say.
    private static let stalenessBound: TimeInterval = 90

    var isStatusFresh: Bool {
        guard isRunning,
              let updatedAt = localStatus?.updatedAt,
              let date = Format.parseISO8601(updatedAt) else { return false }
        return Date().timeIntervalSince(date) <= Self.stalenessBound
    }

    /// The transport story, kept strictly apart from the AI-activity story that
    /// `/tracker/me`'s `presence` tells. "Connected" here means a fresh connection-v1
    /// receipt — the daemon is reaching the server — and implies nothing whatsoever
    /// about whether any AI tool is in use.
    var connectionState: TrackerConnectionState {
        if localStatus?.authRejected == true { return .authRejected }
        guard isStatusFresh else { return .unknown }
        if localStatus?.connected == true { return .connected }
        // "Can't reach" needs evidence: a connection check that ran and failed. The snapshot
        // the daemon writes on start/stop (`writeOfflineStatus`) has no check yet: that is
        // "starting", not offline. Live QA 2026-09-26: 20-30 s of a false "Can't reach
        // VibeHub" after every start, i.e. right after installing or connecting.
        return localStatus?.lastConnectionCheckAt == nil ? .unknown : .disconnected
    }

    /// Whether a snapshot belongs to the account currently signed in. A `status.json`
    /// left by a previous account (different `configFingerprint`) must not be read as
    /// this one's — FC5, "clear the old account". Absent on older builds, which is
    /// treated as "no reason to doubt it" rather than as a mismatch.
    func statusBelongsToCurrentAccount(_ fingerprint: String?) -> Bool {
        guard let recorded = localStatus?.configFingerprint, let fingerprint else { return true }
        return recorded == fingerprint
    }

    /// N3: `SMAppService.register()` and the LaunchAgent both need a stable install
    /// location. `/Applications` and `~/Applications` are the two macOS will launch
    /// from; anywhere else (a mounted disk image, `~/Downloads`, `.build/`) is a copy
    /// that can vanish underneath the job it registered.
    static var isInApplicationsFolder: Bool {
        let path = Bundle.main.bundleURL.resolvingSymlinksInPath().path
        if path.hasPrefix("/Applications/") { return true }
        let userApplications = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Applications").path
        return path.hasPrefix(userApplications + "/")
    }

    nonisolated private static func readStatus() -> LocalTrackerStatus? {
        guard let data = try? Data(contentsOf: statusPath) else { return nil }
        return try? JSONDecoder().decode(LocalTrackerStatus.self, from: data)
    }

    nonisolated private static func readRunningPid() -> pid_t? {
        guard let data = try? Data(contentsOf: pidPath),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let pid = object["pid"] as? Int, pid > 0 else { return nil }
        return pid_t(pid)
    }

    /// Signal 0: doesn't deliver anything, only checks the pid exists and we're allowed
    /// to signal it — the same liveness check the tracker CLI itself uses (`daemon.ts`).
    nonisolated private static func isProcessAlive(_ pid: pid_t) -> Bool {
        kill(pid, 0) == 0
    }
}
