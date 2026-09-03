import Foundation

// Wire model for ~/.vibehub/status.json, written atomically by vibehub/tracker.
// Exact schema: ../../docs/ARCHITECTURE.md §4.4. This app only ever decodes this —
// it never writes the file.
struct StatusFileContents: Decodable {
    let status: String
    let projectAlias: String?
    let tool: String?
    let model: String?
    let sessionStartedAt: String?
    let updatedAt: String
}

// Everything this app can render in the menu bar. `.unavailable` covers "file doesn't
// exist yet" and "file is present but malformed" — both are shown to the user exactly
// like `.offline`, since neither is actionable from here.
enum TrackerStatus: Equatable {
    case active(projectAlias: String, tool: String, model: String, sessionStartedAt: Date)
    case idle(projectAlias: String, tool: String, model: String, sessionStartedAt: Date)
    case offline
    case unavailable

    private static let iso8601Fractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let iso8601Whole = ISO8601DateFormatter()

    private static func parseDate(_ raw: String) -> Date? {
        iso8601Fractional.date(from: raw) ?? iso8601Whole.date(from: raw)
    }

    init(decoding contents: StatusFileContents) {
        switch contents.status {
        case "active", "idle":
            guard
                let projectAlias = contents.projectAlias,
                let tool = contents.tool,
                let model = contents.model,
                let startedRaw = contents.sessionStartedAt,
                let startedAt = Self.parseDate(startedRaw)
            else {
                self = .unavailable
                return
            }
            self = contents.status == "active"
                ? .active(projectAlias: projectAlias, tool: tool, model: model, sessionStartedAt: startedAt)
                : .idle(projectAlias: projectAlias, tool: tool, model: model, sessionStartedAt: startedAt)
        case "offline":
            self = .offline
        default:
            self = .unavailable
        }
    }

    /// Short text for the status bar button itself (menu bar real estate is scarce).
    var statusBarTitle: String {
        switch self {
        case .active(let projectAlias, _, _, _):
            return projectAlias
        case .idle(let projectAlias, _, _, _):
            return "\(projectAlias) · idle"
        case .offline, .unavailable:
            return "VibeHub"
        }
    }

    /// Full descriptive line for the disabled status item at the top of the menu, e.g.
    /// "in project neon-app · Claude Code · 1h 42m" (ARCHITECTURE.md §4.4 example).
    func menuStatusLine(now: Date = Date()) -> String {
        switch self {
        case .active(let projectAlias, let tool, _, let startedAt),
             .idle(let projectAlias, let tool, _, let startedAt):
            let elapsed = Self.formatElapsed(from: startedAt, to: now)
            return "in project \(projectAlias) · \(Self.humanize(tool: tool)) · \(elapsed)"
        case .offline:
            return "Not tracking yet"
        case .unavailable:
            return "Not tracking yet"
        }
    }

    /// Known tracker-supplied tool slugs get a friendly label; anything else (tool is
    /// free-form per ARCHITECTURE.md §2.8) is shown as-is.
    private static func humanize(tool: String) -> String {
        let known = [
            "claude-code": "Claude Code",
            "cursor": "Cursor",
            "codex": "Codex",
        ]
        return known[tool] ?? tool
    }

    private static func formatElapsed(from start: Date, to now: Date) -> String {
        let totalSeconds = max(0, Int(now.timeIntervalSince(start)))
        let days = totalSeconds / 86400
        let hours = (totalSeconds % 86400) / 3600
        let minutes = (totalSeconds % 3600) / 60

        if days > 0 {
            return "\(days)d \(hours)h"
        } else if hours > 0 {
            return "\(hours)h \(minutes)m"
        } else if minutes > 0 {
            return "\(minutes)m"
        } else {
            return "<1m"
        }
    }
}
