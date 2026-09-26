import Foundation

/// Wire model for `GET /api/v1/tracker/me`.
///
/// Field names match the server payload exactly (server/src/lib/tracker-me.ts, pinned by
/// server/src/lib/__checks__/trackerMe.check.ts) so no `CodingKeys` mapping is needed.
/// Every optional here is a real server null, not defensiveness: `model` is null for
/// presence-only tools, `activity` is null when offline, and `displayName`/`avatarUrl`
/// are null on a fresh account.
struct TrackerMe: Codable, Equatable {
    let user: User
    let presence: Presence
    let today: Today
    let tracker: Tracker
    let friendsOnline: FriendsOnline

    struct User: Codable, Equatable {
        let id: String
        let username: String
        let displayName: String?
        let avatarUrl: String?
        let level: Int
    }

    struct Activity: Codable, Equatable {
        /// Null (or the tracker's "unknown" sentinel) when the folder has no alias —
        /// privacy default. Rendered as "Private project", never as "unknown".
        let project: String?
        let tool: String
        let model: String?
        let since: Date
    }

    struct Presence: Codable, Equatable {
        let status: PresenceStatus
        let activity: Activity?
        /// FC6: the account-level "last online" the server already sends and this app
        /// was silently dropping. `max(real AI heartbeat, accepted connection receipt)` —
        /// never token-verification time. Optional because a brand-new account has none.
        let lastSeenAt: Date?
    }

    struct Today: Codable, Equatable {
        let activeSeconds: Int
        /// `null` on the wire when the day had AI activity but no source that measures
        /// tokens contributed to it (checkpoint plan §M.1: a Quadcode-only day, or any
        /// hook-fed tool that reports activity and model but no counts). A measured 0 — a
        /// measuring tool that genuinely used nothing, or an empty day — stays 0. The UI
        /// renders nil as "tokens not reported", never as 0 and never as an estimate
        /// (plan B7). Codable synthesis decodes both a JSON null and an omitted key as nil.
        let tokens: Int?
        /// Start of the session open right now, or nil. The UI ticks forward from this
        /// only while `presence.status == .active` — `activeSeconds` already covers
        /// everything up to the last heartbeat, so it is a live *display* offset only.
        let sessionStartedAt: Date?
        /// Added ahead of the server (`server/src/lib/token-pricing.ts`, lane B).
        /// `decodeIfPresent`-backed by Codable synthesis, so an older server that omits
        /// the key — or sends it as JSON `null` — decodes to `nil` either way; every
        /// already-shipped client picks these up for free the moment the server adds
        /// them, with no version gate.
        let estimatedUsd: Double?
        let byModel: [String: Double]?
        /// Cache reads (lane contract, `vibehub-qa-fix.md`): a secondary number beside
        /// the fresh `tokens`, never added to it. Absent on older servers → nil.
        var cachedTokens: Int? = nil
    }

    struct Device: Codable, Equatable {
        let name: String
        let lastSeenAt: Date?
    }

    struct Tracker: Codable, Equatable {
        let connected: Bool
        let lastSeenAt: Date?
        let devices: [Device]
    }

    struct Friend: Codable, Equatable, Identifiable {
        let username: String
        let displayName: String?
        let avatarUrl: String?
        let status: PresenceStatus
        let activity: Activity?
        /// FC6: same account-level "last online" self gets. Present in the payload
        /// already; decoded here so a friend row can say when, not just that.
        let lastSeenAt: Date?

        var id: String { username }
    }

    struct FriendsOnline: Codable, Equatable {
        let count: Int
        let sample: [Friend]
    }
}

/// Mirrors the server's `PresenceStatus`. An unrecognised value decodes to `.offline`
/// rather than throwing, so a newer server can add a status without bricking older apps.
enum PresenceStatus: String, Codable, Equatable {
    case active
    case idle
    case offline

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = PresenceStatus(rawValue: raw) ?? .offline
    }
}
