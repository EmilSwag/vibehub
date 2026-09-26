import Darwin
import Foundation

enum LaunchAgentError: LocalizedError, Equatable {
    /// `code` is launchctl's error number ("Bootstrap failed: 5: Input/output error" → 5),
    /// falling back to its exit status when the message carries none.
    case launchctl(code: Int32, message: String)
    /// `bootout` returned but launchd never finished unloading the job in time.
    case unloadTimedOut(String)

    var errorDescription: String? {
        switch self {
        case .launchctl(_, let message): return message
        case .unloadTimedOut(let label): return "The background tracker (\(label)) didn\u{2019}t stop in time. Try again."
        }
    }

    var code: Int32? {
        if case .launchctl(let code, _) = self { return code }
        return nil
    }
}

/// Writes, bootstraps and tears down the `com.vibehub.tracker` LaunchAgent — the piece
/// that keeps the embedded tracker running across logins and restarts it if it dies,
/// independent of whether VibeHub.app itself is even open.
///
/// Classic `~/Library/LaunchAgents` + `launchctl bootstrap`/`bootout`, not
/// `SMAppService.agent(plistName:)`: the product decision (`plans/vibehub-mac-app.md`)
/// calls for the app writing this plist itself, and doing so lets `ProgramArguments`
/// embed this app bundle's *current* install path directly and unambiguously.
///
/// **The bootout race** (`plans/vibehub-mac-launchagent-race.md`). `launchctl bootout`
/// returns before launchd has finished tearing the job down — the tracker gets SIGTERM
/// and exits on its own schedule (it closes its session first). A `bootstrap` in that
/// window fails with 37 ("Operation already in progress") or 5 ("Input/output error").
/// The old code bootstrapped immediately and, on that failure, deleted the plist —
/// tracking silently off. Now: poll until the job is really gone, retry 37/5 with
/// backoff, and never delete the plist on failure (only `uninstall` removes it; with
/// `RunAtLoad` a plist left on disk still loads at the next login).
///
/// A plain struct: every method is synchronous and blocking (subprocesses, polling
/// sleeps), so callers run it inside `Task.detached` — never on the main thread.
struct LaunchAgent {
    static let trackerLabel = "com.vibehub.tracker"

    /// How many times a retryable launchctl step is tried, and the first backoff delay
    /// (doubling each time): 0.25 + 0.5 + 1 + 2 + 4 ≈ 7.75s worst case.
    struct RetryPolicy {
        var attempts = 6
        var initialDelay: TimeInterval = 0.25
        /// launchctl error numbers that mean "launchd is still busy with this job".
        var retryableCodes: Set<Int32> = [5, 37]
    }

    /// What `install` actually had to do — for logs and the QA harness.
    enum Outcome: Equatable {
        /// Plist already on disk byte-for-byte (by value) and the job loaded: `kickstart -k` only.
        case kickstarted
        /// Plist written or job not loaded: bootout (if needed) → wait → bootstrap (→ start if RunAtLoad didn't).
        case bootstrapped(retries: Int)
    }

    let label: String
    let plistURL: URL
    var retryPolicy = RetryPolicy()
    /// The tracker closes its open session on SIGTERM before exiting; give it room.
    var unloadTimeout: TimeInterval = 15

    /// `label`/`plistDirectory` are injectable only so the QA harness can prove the
    /// race fix on a throwaway job; the app always uses the defaults.
    init(label: String = LaunchAgent.trackerLabel, plistDirectory: URL? = nil) {
        self.label = label
        let directory = plistDirectory
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/LaunchAgents")
        plistURL = directory.appendingPathComponent("\(label).plist")
    }

    /// The plist is on disk — the durable "tracking is on" record (it loads at login).
    var isInstalled: Bool {
        FileManager.default.fileExists(atPath: plistURL.path)
    }

    /// launchd currently has the job in the user's GUI domain.
    var isLoaded: Bool {
        (try? runLaunchctl(["print", serviceTarget])) != nil
    }

    /// The job's running pid, if launchd reports one.
    var runningPID: Int? {
        guard let output = try? runLaunchctl(["print", serviceTarget]) else { return nil }
        for line in output.split(separator: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("pid = ") { return Int(trimmed.dropFirst("pid = ".count)) }
        }
        return nil
    }

    // MARK: - Install / uninstall

    /// The tracker's own job, pointing at this bundle's embedded Node + CLI.
    @discardableResult
    func install(nodePath: String, cjsPath: String) throws -> Outcome {
        let logDirectory = Self.logDirectory
        try? FileManager.default.createDirectory(at: logDirectory, withIntermediateDirectories: true)
        return try install(plist: Self.trackerPlist(nodePath: nodePath, cjsPath: cjsPath,
                                                    logPath: logDirectory.appendingPathComponent("launchd.log").path))
    }

    /// Unchanged plist + loaded job → `kickstart -k` only (restarts onto the current
    /// binaries — what an upgrade needs — without the unload/reload window). Otherwise:
    /// bootout and *wait* for the unload, write the plist, bootstrap (retrying 37/5),
    /// kickstart. On any failure the plist stays where it is.
    @discardableResult
    func install(plist: [String: Any]) throws -> Outcome {
        assert(!Thread.isMainThread, "LaunchAgent blocks on launchctl; call it off the main thread")
        var plist = plist
        plist["Label"] = label

        let unchanged = onDiskPlist().map { NSDictionary(dictionary: plist).isEqual(to: $0) } ?? false
        if unchanged && isLoaded {
            _ = try retrying { try kickstart() }
            return .kickstarted
        }

        // A stale registration (older plist, moved app) must be fully gone first —
        // bootout alone only *starts* the teardown.
        if isLoaded {
            try? bootout()
            _ = waitUntilUnloaded()
        }

        if !unchanged {
            let data = try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)
            try FileManager.default.createDirectory(at: plistURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: plistURL, options: .atomic)
        }

        let retries = try retrying(beforeRetry: {
            // Still (or again) loaded: finish the teardown before the next attempt.
            if isLoaded {
                try? bootout()
                _ = waitUntilUnloaded()
            }
        }) { try bootstrap() }
        // `RunAtLoad` has normally spawned it already. `kickstart -k` here would kill that
        // fresh process and then *block* for launchd's respawn throttle (ThrottleInterval
        // — 30s for the tracker) — measured at 10s per call with the default. So: give
        // the spawn a moment, and only start it (no -k) if it isn't running. 113 ("Could
        // not find service") can briefly precede registration.
        if !waitForPID(timeout: 1) {
            _ = try retrying(extraCodes: [113]) { try kickstart(kill: false) }
        }
        return .bootstrapped(retries: retries)
    }

    /// Explicit off: boot the job out, wait for it to be gone, remove the plist. Safe to
    /// call when nothing is installed. The only path that deletes the plist.
    func uninstall() throws {
        assert(!Thread.isMainThread, "LaunchAgent blocks on launchctl; call it off the main thread")
        if isLoaded {
            try? bootout()
            if !waitUntilUnloaded() { throw LaunchAgentError.unloadTimedOut(label) }
        }
        if FileManager.default.fileExists(atPath: plistURL.path) {
            try FileManager.default.removeItem(at: plistURL)
        }
    }

    // MARK: - Plist

    static func trackerPlist(nodePath: String, cjsPath: String, logPath: String) -> [String: Any] {
        [
            "Label": trackerLabel,
            // `serve`: the tracker CLI's hidden foreground-daemon command — it owns the
            // pid file directly and exits 0 if a healthy daemon is already running.
            "ProgramArguments": [nodePath, cjsPath, "serve"],
            "RunAtLoad": true,
            // FC1, failure-only restart. `KeepAlive: true` would relaunch deliberate
            // exits too (lock already held, user stop, token rejected) into a permanent
            // throttled loop. `{ SuccessfulExit: false }` relaunches only crashes.
            "KeepAlive": ["SuccessfulExit": false],
            // Rate limit on crash restarts; matches the tracker's heartbeat cadence.
            "ThrottleInterval": 30,
            "ProcessType": "Background",
            // The tracker resolves every path from `os.homedir()` — state it explicitly.
            "EnvironmentVariables": ["HOME": FileManager.default.homeDirectoryForCurrentUser.path],
            "StandardOutPath": logPath,
            "StandardErrorPath": logPath,
        ]
    }

    private func onDiskPlist() -> NSDictionary? {
        guard let data = try? Data(contentsOf: plistURL),
              let object = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any]
        else { return nil }
        return NSDictionary(dictionary: object)
    }

    private static var logDirectory: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".vibehub")
    }

    // MARK: - launchctl

    private var domain: String { "gui/\(getuid())" }
    private var serviceTarget: String { "\(domain)/\(label)" }

    private func bootstrap() throws {
        try runLaunchctl(["bootstrap", domain, plistURL.path])
    }

    private func bootout() throws {
        try runLaunchctl(["bootout", serviceTarget])
    }

    /// `-k`: kill the job first if it's already running, then start it fresh — what an
    /// upgrade needs to move onto replaced binaries. Blocks while launchd's respawn
    /// throttle runs if the job started less than ThrottleInterval ago.
    private func kickstart(kill: Bool = true) throws {
        try runLaunchctl(kill ? ["kickstart", "-k", serviceTarget] : ["kickstart", serviceTarget])
    }

    private func waitForPID(timeout: TimeInterval) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if runningPID != nil { return true }
            Thread.sleep(forTimeInterval: 0.05)
        } while Date() < deadline
        return runningPID != nil
    }

    /// Polls `launchctl print` until launchd no longer knows the job. True once gone.
    @discardableResult
    func waitUntilUnloaded() -> Bool {
        let deadline = Date().addingTimeInterval(unloadTimeout)
        while Date() < deadline {
            if !isLoaded { return true }
            Thread.sleep(forTimeInterval: 0.1)
        }
        return !isLoaded
    }

    /// Runs `step`, retrying launchctl's "still busy" errors with exponential backoff.
    /// Returns how many retries it took. Any other error — or the last busy one — throws.
    private func retrying(extraCodes: Set<Int32> = [], beforeRetry: () -> Void = {}, _ step: () throws -> Void) throws -> Int {
        var delay = retryPolicy.initialDelay
        let codes = retryPolicy.retryableCodes.union(extraCodes)
        for attempt in 0..<retryPolicy.attempts {
            do {
                try step()
                return attempt
            } catch let error as LaunchAgentError {
                guard let code = error.code, codes.contains(code), attempt < retryPolicy.attempts - 1 else { throw error }
                Thread.sleep(forTimeInterval: delay)
                delay *= 2
                beforeRetry()
            }
        }
        return retryPolicy.attempts // unreachable: the last attempt either returns or throws
    }

    @discardableResult
    private func runLaunchctl(_ arguments: [String]) throws -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        process.arguments = arguments
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        try process.run()
        // Read before waiting — avoids a pipe-buffer deadlock on `print`'s long output.
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        let output = String(data: data, encoding: .utf8) ?? ""
        guard process.terminationStatus == 0 else {
            let message = output.trimmingCharacters(in: .whitespacesAndNewlines)
            let detail = message.isEmpty ? "launchctl \(arguments.joined(separator: " ")) failed" : message
            throw LaunchAgentError.launchctl(code: Self.errorCode(in: message) ?? process.terminationStatus, message: detail)
        }
        return output
    }

    /// "Bootstrap failed: 37: Operation already in progress" → 37.
    static func errorCode(in message: String) -> Int32? {
        guard let range = message.range(of: "failed: ") else { return nil }
        let digits = message[range.upperBound...].prefix { $0.isNumber }
        return Int32(digits)
    }
}
