import Foundation

enum APIError: LocalizedError, Equatable {
    case noToken
    case unauthorized
    case server(Int)
    case transport(String)
    case decoding(String)

    var errorDescription: String? {
        switch self {
        case .noToken: return "No tracker token"
        case .unauthorized: return "Token rejected. Paste a fresh one in Settings."
        case .server(let code): return "Server error (\(code))"
        case .transport: return "Can't reach VibeHub"
        case .decoding: return "Unexpected response"
        }
    }

    /// Retrying a rejected or missing token just burns requests — only these recover.
    var isRetryable: Bool {
        switch self {
        case .noToken, .unauthorized: return false
        case .server, .transport, .decoding: return true
        }
    }
}

/// One endpoint, no dependencies.
struct APIClient {
    var baseURL: URL

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        // The server emits `new Date().toISOString()` — always fractional seconds and a
        // Z suffix. `.iso8601` alone rejects fractional seconds, so parse explicitly and
        // fall back to the non-fractional form rather than failing the whole payload.
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]

        decoder.dateDecodingStrategy = .custom { decoder in
            let raw = try decoder.singleValueContainer().decode(String.self)
            if let date = withFraction.date(from: raw) ?? plain.date(from: raw) { return date }
            throw DecodingError.dataCorrupted(
                .init(codingPath: decoder.codingPath, debugDescription: "Not an ISO-8601 date: \(raw)")
            )
        }
        return decoder
    }()

    func fetchMe(token: String) async -> Result<TrackerMe, APIError> {
        guard !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return .failure(.noToken) }

        var request = URLRequest(url: baseURL.appendingPathComponent("api/v1/tracker/me"))
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 15
        // Presence goes stale in seconds; a cached body would show a frozen menu bar.
        request.cachePolicy = .reloadIgnoringLocalCacheData

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else { return .failure(.transport("No HTTP response")) }
            if http.statusCode == 401 || http.statusCode == 403 { return .failure(.unauthorized) }
            guard (200..<300).contains(http.statusCode) else { return .failure(.server(http.statusCode)) }

            do {
                return .success(try Self.decoder.decode(TrackerMe.self, from: data))
            } catch {
                return .failure(.decoding(String(describing: error)))
            }
        } catch {
            return .failure(.transport(error.localizedDescription))
        }
    }
}
