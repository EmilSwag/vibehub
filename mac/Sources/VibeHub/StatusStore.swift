import Combine
import Foundation
import SwiftUI

/// Owns the poll loop and everything the UI renders.
///
/// Cadence (spec): 15s with the popover closed, 3s while it's open, exponential back-off
/// once requests start failing. A single `Task` loop rather than a `Timer` so the
/// interval can change mid-flight and so it cancels cleanly on quit.
@MainActor
final class StatusStore: ObservableObject {
    enum Phase: Equatable {
        case needsToken
        case loading
        case loaded(TrackerMe)
        case failed(APIError)
    }

    @Published private(set) var phase: Phase = .needsToken
    /// Drives the live "since" timers. Ticking one published value beats a Timer per row.
    @Published private(set) var now: Date = Date()
    @Published var popoverIsOpen: Bool = false {
        didSet { if popoverIsOpen != oldValue { wake() } }
    }

    private let settings: AppSettings
    private var client: APIClient
    private var pollTask: Task<Void, Never>?
    private var tickTask: Task<Void, Never>?
    private var consecutiveFailures = 0
    private var cancellables: Set<AnyCancellable> = []

    private let openInterval: Duration = .seconds(3)
    private let closedInterval: Duration = .seconds(15)
    private let maxBackoff: Duration = .seconds(300)

    init(settings: AppSettings) {
        self.settings = settings
        self.client = APIClient(baseURL: settings.baseURL)
        if Keychain.readToken() == nil {
            phase = .needsToken
        } else {
            phase = .loading
        }

        // A handoff/deep-link naming a non-default server (`AppSettings.adopt`) can
        // arrive after this store already exists — rebuild the client so the *next*
        // poll uses it, rather than the one captured at construction time.
        settings.$baseURL
            .dropFirst()
            .receive(on: RunLoop.main)
            .sink { [weak self] newBaseURL in
                guard let self else { return }
                self.client = APIClient(baseURL: newBaseURL)
                self.wake()
            }
            .store(in: &cancellables)
    }

    var token: String? { Keychain.readToken() }

    #if DEBUG
    /// QA harness only: a store frozen on one phase — no poll loop, no network, no
    /// Keychain. `now` is pinned too, so snapshot timers render the same every run.
    private(set) var isFixture = false

    convenience init(settings: AppSettings, fixture phase: Phase, now: Date) {
        self.init(settings: settings)
        isFixture = true
        self.phase = phase
        self.now = now
    }
    #endif

    var snapshot: TrackerMe? {
        if case .loaded(let me) = phase { return me }
        return nil
    }

    /// Today's active seconds, ticking forward live while actually active. The server
    /// value is a snapshot to the last heartbeat; we add wall-clock only for the open
    /// session and only while `.active`, which is exactly what `sessionStartedAt` is for.
    var liveActiveSeconds: Int? {
        guard let me = snapshot else { return nil }
        guard me.presence.status == .active, let started = me.today.sessionStartedAt else {
            return me.today.activeSeconds
        }
        let sinceHeartbeat = max(0, Int(now.timeIntervalSince(max(started, me.tracker.lastSeenAt ?? started))))
        return me.today.activeSeconds + sinceHeartbeat
    }

    func start() {
        #if DEBUG
        if isFixture { return }
        #endif
        guard pollTask == nil else { return }
        // Both loops inherit this class's @MainActor isolation, so `self` is touched on
        // the main actor throughout and no extra hops are needed.
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                await self.refresh()
                try? await Task.sleep(for: self.nextDelay())
            }
        }
        tickTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                guard let self else { return }
                self.now = Date()
            }
        }
    }

    func stop() {
        pollTask?.cancel()
        tickTask?.cancel()
        pollTask = nil
        tickTask = nil
    }

    /// Re-read the token, drop any back-off, and poll immediately — used when the
    /// popover opens, after the token is saved, and by the error state's Retry.
    func wake() {
        #if DEBUG
        if isFixture { return }
        #endif
        consecutiveFailures = 0
        Task { await refresh() }
    }

    private func nextDelay() -> Duration {
        guard consecutiveFailures > 0 else { return popoverIsOpen ? openInterval : closedInterval }
        // 15s, 30s, 60s, 120s, 240s, capped — a laptop that's been asleep or offline all
        // night wakes up having made a handful of requests, not thousands.
        let base = popoverIsOpen ? openInterval : closedInterval
        let factor = min(1 << min(consecutiveFailures - 1, 8), 32)
        let scaled = base * factor
        return scaled > maxBackoff ? maxBackoff : scaled
    }

    private func refresh() async {
        guard let token = Keychain.readToken() else {
            phase = .needsToken
            consecutiveFailures = 0
            return
        }
        if case .needsToken = phase { phase = .loading }

        switch await client.fetchMe(token: token) {
        case .success(let me):
            consecutiveFailures = 0
            phase = .loaded(me)
            now = Date()
        case .failure(let error):
            if error.isRetryable {
                consecutiveFailures += 1
                // Keep showing the last good snapshot through a blip; only surface the
                // error once it's clearly not a one-off.
                if snapshot == nil || consecutiveFailures >= 2 { phase = .failed(error) }
            } else {
                consecutiveFailures = 0
                phase = error == .noToken ? .needsToken : .failed(error)
            }
        }
    }
}
