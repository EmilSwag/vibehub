import Darwin
import Foundation

enum LaunchAgentError: LocalizedError, Equatable {
    case launchctl(String)

    var errorDescription: String? {
        switch self {
        case .launchctl(let message): return message
        }
    }
}

/// Writes, bootstraps and tears down the `com.vibehub.tracker` LaunchAgent — the piece
/// that keeps the embedded tracker running across logins and restarts it if it dies,
/// independent of whether VibeHub.app itself is even open.
///
/// Classic `~/Library/LaunchAgents` + `launchctl bootstrap`/`bootout`, not
/// `SMAppService.agent(plistName:)`: the product decision (`plans/vibehub-mac-app.md`)
/// calls for the app writing this plist itself, and doing so lets `ProgramArguments`
/// embed this app bundle's *current* install path directly and unambiguously — no
/// reliance on how `SMAppService` resolves a bundled agent plist's paths relative to
/// wherever the .app happens to be installed.
///
/// A plain struct, not a class: every method here is synchronous and blocking
/// (`launchctl` is a subprocess call), by design, so `TrackerManager` can run them
/// inside `Task.detached` without smuggling actor-isolated state across the hop.
struct LaunchAgent {
    static let label = "com.vibehub.tracker"

    private var plistURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/LaunchAgents/\(Self.label).plist")
    }

    var isInstalled: Bool {
        FileManager.default.fileExists(atPath: plistURL.path)
    }

    /// Writes the plist, then `bootout` (clear any stale registration) / `bootstrap`
    /// (load it into the user's GUI domain) / `kickstart -k` (force a fresh start now,
    /// rather than trust that `RunAtLoad` alone always fires promptly on this specific
    /// bootstrap) — in that order.
    func install(nodePath: String, cjsPath: String) throws {
        // A stale bootstrap from a previous app install path (moved/reinstalled
        // VibeHub.app) must not linger and race the new one.
        try? bootout()

        let logDirectory = Self.logDirectory
        try? FileManager.default.createDirectory(at: logDirectory, withIntermediateDirectories: true)
        let logPath = logDirectory.appendingPathComponent("launchd.log").path

        // `serve`: tracker CLI's hidden foreground-daemon command (plan lane B,
        // `tracker/**`), designed for exactly this — it owns the pid file directly
        // instead of self-detaching, and exits 0 rather than duplicate-heartbeating if
        // a healthy daemon is already running elsewhere.
        let plist: [String: Any] = [
            "Label": Self.label,
            "ProgramArguments": [nodePath, cjsPath, "serve"],
            "RunAtLoad": true,
            // FC1, failure-only restart. `KeepAlive: true` relaunches *every* exit,
            // including the deliberate ones — `serve` exiting 0 because another process
            // already holds the tracker lock, because the user stopped it, or because
            // the token was rejected and it refuses to retry. Under `true` each of those
            // becomes a permanent relaunch loop: throttled to 30s, but never-ending, and
            // the auth-invalid case would keep a credential-less daemon waking forever
            // with the app closed and nobody watching.
            //
            // `{ SuccessfulExit: false }` reads as "keep alive only while it is *not*
            // exiting successfully": exit 0 is left alone, a non-zero exit (a genuine
            // crash) is relaunched. Transient network failures must never reach launchd
            // at all — `serve` retries those in-process while holding its lock, because
            // exiting to get restarted would drop the lock and race the next instance.
            "KeepAlive": ["SuccessfulExit": false],
            // Caps how often launchd will relaunch a *crashing* job (its default is
            // effectively 10s) — 30s matches the tracker's own heartbeat cadence. It is
            // a rate limit on crash restarts, never a backoff strategy in its own right.
            "ThrottleInterval": 30,
            "ProcessType": "Background",
            // launchd GUI agents normally inherit HOME already, but the tracker CLI
            // resolves every path it touches from `os.homedir()` — stating it
            // explicitly removes any doubt for a daemon whose correctness this app
            // depends on silently, with no UI if it ever got it wrong.
            "EnvironmentVariables": ["HOME": FileManager.default.homeDirectoryForCurrentUser.path],
            "StandardOutPath": logPath,
            "StandardErrorPath": logPath,
        ]
        let data = try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)

        let directory = plistURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try data.write(to: plistURL, options: .atomic)

        do {
            try bootstrap()
            try kickstart()
        } catch {
            // `isInstalled` only checks for the plist file — a failed bootstrap/
            // kickstart must not leave one behind, or the popover would call this "on"
            // when launchd never actually took the job.
            try? bootout()
            try? FileManager.default.removeItem(at: plistURL)
            throw error
        }
    }

    /// Boots the job out first (best-effort — nothing to boot out is not an error),
    /// then removes the plist. Safe to call when nothing is installed.
    func uninstall() throws {
        try? bootout()
        if FileManager.default.fileExists(atPath: plistURL.path) {
            try FileManager.default.removeItem(at: plistURL)
        }
    }

    private static var logDirectory: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".vibehub")
    }

    private func bootstrap() throws {
        try runLaunchctl(["bootstrap", "gui/\(getuid())", plistURL.path])
    }

    private func bootout() throws {
        try runLaunchctl(["bootout", "gui/\(getuid())/\(Self.label)"])
    }

    /// `-k`: kill the job first if it's already running, then start it fresh. Forces a
    /// known-good start right after `bootstrap` rather than trusting `RunAtLoad` alone.
    private func kickstart() throws {
        try runLaunchctl(["kickstart", "-k", "gui/\(getuid())/\(Self.label)"])
    }

    private func runLaunchctl(_ arguments: [String]) throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        process.arguments = arguments
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        try process.run()
        // Read before waiting, matching `TrackerProcess` — launchctl's output here is a
        // one-liner at most, but the ordering avoids the same pipe-buffer deadlock.
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            let message = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
            let detail = (message?.isEmpty == false ? message! : nil) ?? "launchctl \(arguments.joined(separator: " ")) failed"
            throw LaunchAgentError.launchctl(detail)
        }
    }
}
