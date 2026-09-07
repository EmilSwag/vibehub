import AppKit
import SwiftUI

/// The whole UI: one ~320pt column. System colours and SF Symbols only — no brand
/// colours, no illustrations, one primary action per state.
struct PopoverView: View {
    @ObservedObject var store: StatusStore
    @ObservedObject var settings: AppSettings

    @State private var showingSettings = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if showingSettings {
                SettingsView(store: store, settings: settings, onClose: { showingSettings = false })
            } else {
                content
                Divider().padding(.vertical, 6)
                actions
            }
        }
        .padding(12)
        .frame(width: 320)
        // The poll loop speeds up to 3s while this is on screen and drops back to 15s
        // when it closes. `.window` style has no isPresented binding on macOS 13, so the
        // content's own lifecycle is the signal.
        .onAppear { store.popoverIsOpen = true }
        .onDisappear { store.popoverIsOpen = false }
    }

    @ViewBuilder
    private var content: some View {
        switch store.phase {
        case .needsToken:
            OnboardingView(store: store, settings: settings)
        case .loading:
            loadingSkeleton
        case .failed(let error):
            errorState(error)
        case .loaded(let me):
            loadedContent(me)
        }
    }

    // MARK: - Loaded

    private func loadedContent(_ me: TrackerMe) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            header(me)
            nowBlock(me)
            todayBlock(me)
            friendsBlock(me)
        }
    }

    private func header(_ me: TrackerMe) -> some View {
        HStack(spacing: 9) {
            Avatar(url: me.user.avatarUrl, name: me.user.displayName ?? me.user.username, size: 34)
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 5) {
                    Text(me.user.displayName ?? me.user.username)
                        .font(.system(size: 14, weight: .semibold))
                        .lineLimit(1)
                    PresenceDot(status: me.presence.status)
                }
                Text("@\(me.user.username)")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
    }

    private func nowBlock(_ me: TrackerMe) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            SectionLabel(text: "Now")
            if let activity = me.presence.activity {
                Text(Format.activityLine(activity))
                    .font(.system(size: 13))
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                Text(Format.elapsedShort(since: activity.since, now: store.now))
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            } else {
                // Empty state: one sentence, and the action that resolves it is already
                // in the list below — no second button here.
                Text(me.tracker.connected ? "Nothing open right now." : "Tracker offline.")
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func todayBlock(_ me: TrackerMe) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            SectionLabel(text: "Today")
            HStack(spacing: 0) {
                stat(Format.compactDuration(seconds: store.liveActiveSeconds ?? me.today.activeSeconds), "active")
                Spacer(minLength: 8)
                stat(Format.compactCount(me.today.tokens), "tokens")
                Spacer(minLength: 8)
                stat("\(me.user.level)", "level")
            }
        }
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(value)
                .font(.system(size: 15, weight: .medium))
                .monospacedDigit()
            Text(label)
                .font(.system(size: 10))
                .foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func friendsBlock(_ me: TrackerMe) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionLabel(text: "Friends online: \(me.friendsOnline.count)")
            if me.friendsOnline.sample.isEmpty {
                Text("Nobody's coding right now.")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
            } else {
                ForEach(me.friendsOnline.sample) { friend in
                    HStack(spacing: 7) {
                        Avatar(url: friend.avatarUrl, name: friend.displayName ?? friend.username, size: 20)
                        Text(friend.displayName ?? friend.username)
                            .font(.system(size: 12))
                            .lineLimit(1)
                        PresenceDot(status: friend.status, size: 6)
                        Spacer(minLength: 0)
                        if let activity = friend.activity {
                            Text(Format.toolLabel(activity.tool))
                                .font(.system(size: 11))
                                .foregroundStyle(.tertiary)
                                .lineLimit(1)
                        }
                    }
                }
                // `count` can exceed what fits; say so rather than silently truncating.
                if me.friendsOnline.count > me.friendsOnline.sample.count {
                    Text("+\(me.friendsOnline.count - me.friendsOnline.sample.count) more")
                        .font(.system(size: 11))
                        .foregroundStyle(.tertiary)
                }
            }
        }
    }

    // MARK: - Loading / error

    private var loadingSkeleton: some View {
        // Same shapes and spacing as the loaded state, so nothing jumps when data lands.
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 9) {
                Circle().fill(Color.secondary.opacity(0.15)).frame(width: 34, height: 34)
                VStack(alignment: .leading, spacing: 5) {
                    SkeletonBar(width: 110, height: 11)
                    SkeletonBar(width: 70, height: 9)
                }
                Spacer(minLength: 0)
            }
            VStack(alignment: .leading, spacing: 5) {
                SectionLabel(text: "Now")
                SkeletonBar(width: 210, height: 11)
                SkeletonBar(width: 60, height: 9)
            }
            VStack(alignment: .leading, spacing: 5) {
                SectionLabel(text: "Today")
                SkeletonBar(width: 240, height: 14)
            }
        }
    }

    private func errorState(_ error: APIError) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "exclamationmark.triangle")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                Text(error.errorDescription ?? "Something went wrong")
                    .font(.system(size: 13))
                    .fixedSize(horizontal: false, vertical: true)
            }
            // Inline, next to the thing that failed, with the one action that helps.
            if error == .unauthorized {
                Button("Open Settings") { showingSettings = true }
                    .buttonStyle(.borderless)
                    .font(.system(size: 12))
            } else {
                Button("Retry") { store.wake() }
                    .buttonStyle(.borderless)
                    .font(.system(size: 12))
            }
        }
    }

    // MARK: - Actions

    private var actions: some View {
        VStack(spacing: 1) {
            ActionRow(title: "Open VibeHub", symbol: "arrow.up.forward.app") {
                open(settings.baseURL)
            }
            ActionRow(title: "Go online", symbol: "bolt") {
                open(settings.baseURL.appending(queryItem: URLQueryItem(name: "connect", value: "1")))
            }
            if store.token != nil {
                ActionRow(title: "Copy tracker token", symbol: "doc.on.doc") {
                    guard let token = store.token else { return }
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(token, forType: .string)
                }
            }
            ActionRow(title: "Settings", symbol: "gearshape") { showingSettings = true }
            ActionRow(title: "Quit VibeHub", symbol: "power") { NSApplication.shared.terminate(nil) }
        }
    }

    private func open(_ url: URL) {
        NSWorkspace.shared.open(url)
    }
}

extension URL {
    /// `URL.appending(queryItems:)` is macOS 13+, but takes an array and returns a
    /// non-optional; this keeps the call sites readable and the deployment target honest.
    func appending(queryItem: URLQueryItem) -> URL {
        guard var components = URLComponents(url: self, resolvingAgainstBaseURL: false) else { return self }
        components.queryItems = (components.queryItems ?? []) + [queryItem]
        return components.url ?? self
    }
}
