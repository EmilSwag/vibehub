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
        let project: String
        let tool: String
        let model: String?
        let since: Date
    }

    struct Presence: Codable, Equatable {
        let status: PresenceStatus
        let activity: Activity?
    }

    struct Today: Codable, Equatable {
        let activeSeconds: Int
        let tokens: Int
        /// Start of the session open right now, or nil. The UI ticks forward from this
        /// only while `presence.status == .active` — `activeSeconds` already covers
        /// everything up to the last heartbeat, so it is a live *display* offset only.
        let sessionStartedAt: Date?
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
