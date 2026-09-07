import Foundation

/// Presentation helpers. Mirrors `web/src/lib/format.ts` so the menu bar and the web
/// read identically — same "1h 42m" shape, same tool/model humanising, same rule that a
/// null model is dropped rather than printed as "unknown".
enum Format {
    /// "just now" under a minute, then "5m", then "1h 42m". Never negative.
    static func elapsedShort(since: Date, now: Date = Date()) -> String {
        let seconds = Int(now.timeIntervalSince(since))
        guard seconds >= 60 else { return "just now" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes)m" }
        return "\(minutes / 60)h \(minutes % 60)m"
    }

    /// Compact form for the menu bar itself, where every pixel is shared with other
    /// apps: "0m", "42m", "2h 14m".
    static func compactDuration(seconds: Int) -> String {
        let minutes = max(0, seconds) / 60
        if minutes < 60 { return "\(minutes)m" }
        return "\(minutes / 60)h \(minutes % 60)m"
    }

    /// 1_250 → "1.3k", 125_000 → "125k", 2_400_000 → "2.4M".
    static func compactCount(_ value: Int) -> String {
        let n = max(0, value)
        switch n {
        case 0..<1_000:
            return "\(n)"
        case 1_000..<10_000:
            return String(format: "%.1fk", Double(n) / 1_000).replacingOccurrences(of: ".0", with: "")
        case 10_000..<1_000_000:
            return "\(n / 1_000)k"
        default:
            return String(format: "%.1fM", Double(n) / 1_000_000).replacingOccurrences(of: ".0", with: "")
        }
    }

    private static let toolNames: [String: String] = [
        "claude-code": "Claude Code",
        "claude_code": "Claude Code",
        "codex": "Codex CLI",
        "cursor": "Cursor",
        "vscode": "VS Code",
        "visual-studio-code": "VS Code",
        "code": "VS Code",
        "windsurf": "Windsurf",
        "zed": "Zed",
        "quadcode": "Quadcode AI",
        "genui": "Quadcode AI",
        "chatgpt": "ChatGPT",
        "grok": "Grok",
    ]

    static func toolLabel(_ raw: String?) -> String {
        guard let raw, !raw.isEmpty else { return "Unknown tool" }
        let key = raw.lowercased().trimmingCharacters(in: .whitespaces)
        if key == "unknown" { return "Unknown tool" }
        if let known = toolNames[key] { return known }
        // my-tool → My Tool. `String(...)` on the tail matters: `String + Substring`
        // has no overload.
        return key
            .split(whereSeparator: { $0 == "-" || $0 == "_" || $0 == " " })
            .map { $0.prefix(1).uppercased() + String($0.dropFirst()) }
            .joined(separator: " ")
    }

    /// The server already normalises "unknown"/"<synthetic>"/"" to null, so this only
    /// prettifies. Kept tolerant anyway — an older server may still send a sentinel.
    static func modelLabel(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, trimmed.lowercased() != "unknown", trimmed != "<synthetic>" else { return nil }
        return trimmed
    }

    /// "vibehub · Claude Code · Claude Opus 5" — segments that are nil simply vanish, so
    /// a presence-only tool never renders a dangling separator.
    static func activityLine(_ activity: TrackerMe.Activity) -> String {
        [activity.project, toolLabel(activity.tool), modelLabel(activity.model)]
            .compactMap { $0 }
            .joined(separator: " · ")
    }

    static func statusLabel(_ status: PresenceStatus) -> String {
        switch status {
        case .active: return "Online"
        case .idle: return "Idle"
        case .offline: return "Offline"
        }
    }
}
