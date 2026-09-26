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

    /// Casing fixes for identifiers whose title-cased form would be wrong ("Vscode",
    /// "Chatgpt"), plus the product names the web spells differently from their ids
    /// ("Codex CLI", "Quadcode AI"). Mirrors `TOOL_NAMES` in `web/src/lib/format.ts` so
    /// the menu bar and the site name a tool identically.
    ///
    /// These are **display labels, not a support matrix.** Which tools the collector
    /// actually measures is decided in `tracker/src/privacy.ts` and reported by the
    /// server; this map only decides how an id the server already sent is spelled. A
    /// tool this app has never heard of falls through to generic title-casing below
    /// (`my-tool` → "My Tool"), so a newly supported id — `cursor`, `windsurf`, whatever
    /// comes next — renders correctly without a native release. Nothing here hardcodes
    /// Claude Code and Codex as the only tools, and nothing here implies collection the
    /// product does not do: the label is the name, the server decides the rest.
    private static let toolNames: [String: String] = [
        "claude-code": "Claude Code",
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
        guard let raw else { return "Unknown tool" }
        // Same normalisation as the web's `normalizeToolId`: lower-case kebab, so a
        // snake_case id from an older tracker build ("claude_code") hits the same entry.
        let key = raw.lowercased().trimmingCharacters(in: .whitespaces)
            .split(whereSeparator: { $0 == "_" || $0 == " " })
            .joined(separator: "-")
        if key.isEmpty || key == "unknown" { return "Unknown tool" }
        if let known = toolNames[key] { return known }
        // my-tool → My Tool. `String(...)` on the tail matters: `String + Substring`
        // has no overload.
        return key
            .split(separator: "-")
            .map { $0.prefix(1).uppercased() + String($0.dropFirst()) }
            .joined(separator: " ")
    }

    /// Display name for a raw model id (lane contract, `vibehub-qa-fix.md`):
    /// `claude-opus-5-5` → "Opus 5.5", `claude-haiku-4-5-20251001` → "Haiku 4.5",
    /// `claude-3-5-sonnet-20241022` → "Sonnet 3.5", `gpt-6-sol` → "GPT-6 Sol",
    /// `gpt-5.6-terra` → "GPT-5.6 Terra". Anything else is shown as-is. Sentinels
    /// ("", "unknown", "null", "<synthetic>") return nil — never the word "null".
    static func modelLabel(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespaces)
        let lower = trimmed.lowercased()
        guard !trimmed.isEmpty, !["unknown", "null", "none", "<synthetic>"].contains(lower) else { return nil }
        // "[1m]"-style context suffixes and "-latest" carry no identity.
        var id = lower
        if let bracket = id.firstIndex(of: "[") { id = String(id[..<bracket]) }
        if id.hasSuffix("-latest") { id = String(id.dropLast("-latest".count)) }
        if id.hasPrefix("claude-") {
            return claudeLabel(String(id.dropFirst("claude-".count))) ?? trimmed
        }
        if id.hasPrefix("gpt-") {
            return gptLabel(String(id.dropFirst("gpt-".count))) ?? trimmed
        }
        return trimmed
    }

    /// Words are the family ("opus"), 1–2 digit numbers the version; an 8-digit (or
    /// dated `yyyy-mm-dd`) tail is a snapshot date and dropped.
    private static func claudeLabel(_ rest: String) -> String? {
        var words: [String] = []
        var numbers: [String] = []
        for part in rest.split(whereSeparator: { $0 == "-" || $0 == "@" || $0 == "_" }) {
            let piece = String(part)
            if piece.allSatisfy(\.isNumber) {
                if piece.count <= 2 { numbers.append(piece) } // 8-digit snapshot dates skipped
            } else if piece.allSatisfy(\.isLetter) {
                words.append(piece)
            } else {
                return nil
            }
        }
        guard let family = words.first, !numbers.isEmpty else { return nil }
        let name = ([family] + words.dropFirst()).map(capitalized).joined(separator: " ")
        return "\(name) \(numbers.joined(separator: "."))"
    }

    /// First part is the version ("6", "5.6", "4o"), the rest are words; ISO dates dropped.
    private static func gptLabel(_ rest: String) -> String? {
        var parts = rest.split(separator: "-").map(String.init)
        guard let version = parts.first, version.first?.isNumber == true else { return nil }
        parts.removeFirst()
        // gpt-4o-2024-08-06 → drop the trailing yyyy-mm-dd.
        while let last = parts.last, last.allSatisfy(\.isNumber) { parts.removeLast() }
        let words = parts.map(capitalized)
        return (["GPT-\(version)"] + words).joined(separator: " ")
    }

    private static func capitalized(_ word: String) -> String {
        word.prefix(1).uppercased() + String(word.dropFirst())
    }

    /// Null / "unknown" / "hidden" project → the neutral label (privacy default, R5).
    static let privateProject = "Private project"

    static func isPrivateProject(_ raw: String?) -> Bool {
        guard let raw = raw?.trimmingCharacters(in: .whitespaces), !raw.isEmpty else { return true }
        return ["unknown", "null", "hidden"].contains(raw.lowercased())
    }

    static func projectLabel(_ raw: String?) -> String {
        isPrivateProject(raw) ? privateProject : raw!.trimmingCharacters(in: .whitespaces)
    }

    /// "neon-app · Claude Code · Opus 5.5" — segments that are nil simply vanish, so
    /// a presence-only tool never renders a dangling separator.
    static func activityLine(_ activity: TrackerMe.Activity) -> String {
        [projectLabel(activity.project), toolLabel(activity.tool), modelLabel(activity.model)]
            .compactMap { $0 }
            .joined(separator: " · ")
    }

    /// Secondary line under fresh tokens: "+540M cached". Nil when absent or zero.
    static func cachedLine(_ value: Int?) -> String? {
        guard let value, value > 0 else { return nil }
        return "+\(compactCount(value)) cached"
    }

    static func statusLabel(_ status: PresenceStatus) -> String {
        switch status {
        case .active: return "Online"
        case .idle: return "Idle"
        case .offline: return "Offline"
        }
    }

    /// $1.30k is never shown — spend reads as a raw dollar amount at any size, just
    /// rounded once it clears single digits, where the cents stop being the point.
    static func compactUsd(_ value: Double) -> String {
        let amount = max(0, value)
        return amount < 10 ? String(format: "$%.2f", amount) : String(format: "$%.0f", amount)
    }

    /// What an em-dash means here, and why it is not "$0.00".
    ///
    /// The server sends `estimatedUsd: null` when tokens exist but no model in the
    /// bucket has a verified price, and `0` only for a genuinely empty day. Rendering
    /// null as a zero would state that today's work cost nothing, which is a different
    /// and false claim; hiding the row entirely would silently change the shape of the
    /// stats row depending on which models someone happened to use. So: unavailable is
    /// shown, and shown as unavailable.
    static let unavailableValue = "\u{2014}"

    /// `nil` → "—" (unavailable, see above), otherwise the compact dollar amount.
    static func optionalUsd(_ value: Double?) -> String {
        guard let value else { return unavailableValue }
        return compactUsd(value)
    }

    /// Plan B7, "tokens not reported". The server sends `today.tokens: null` when the day
    /// had AI activity but no source that measures tokens contributed to it (a
    /// Quadcode-only day; a hook-fed tool that reports activity and model only). That is
    /// unknown, not zero — "0" would claim the work used no tokens — and it is never
    /// estimated. The value slot shows the same em-dash the ≈$ slot uses for the same
    /// reason; `tokensLabel` puts the words underneath, so the stat reads "— tokens not
    /// reported" rather than a bare dash the eye could take for a rendering glitch.
    static func optionalCount(_ value: Int?) -> String {
        guard let value else { return unavailableValue }
        return compactCount(value)
    }

    /// The label under a tokens stat: "tokens" when counted, B7's exact words when not.
    static func tokensLabel(_ value: Int?) -> String {
        value == nil ? "tokens not reported" : "tokens"
    }

    /// Same fractional-seconds-tolerant parsing as `APIClient`'s decoder, for the one
    /// place outside `Codable` decoding that needs a raw ISO-8601 timestamp: the local
    /// tracker's `status.json` (`TrackerManager.LocalTrackerStatus`), read as plain
    /// strings rather than through `JSONDecoder`'s date strategy.
    static func parseISO8601(_ raw: String) -> Date? {
        struct Formatters {
            static let withFraction: ISO8601DateFormatter = {
                let formatter = ISO8601DateFormatter()
                formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                return formatter
            }()
            static let plain: ISO8601DateFormatter = {
                let formatter = ISO8601DateFormatter()
                formatter.formatOptions = [.withInternetDateTime]
                return formatter
            }()
        }
        return Formatters.withFraction.date(from: raw) ?? Formatters.plain.date(from: raw)
    }
}
