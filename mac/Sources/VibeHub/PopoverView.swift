import AppKit
import SwiftUI

/// The whole UI: one ~320pt column. System colours and SF Symbols only — no brand
/// colours, no illustrations, one primary action per state.
struct PopoverView: View {
    @ObservedObject var store: StatusStore
    @ObservedObject var settings: AppSettings
    @ObservedObject var tracker: TrackerManager

    @State private var showingSettings = false
    @State private var naming = false
    @State private var folderName = ""
    @State private var projectName = ""
    @State private var nameNote: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if showingSettings {
                SettingsView(store: store, settings: settings, tracker: tracker, onClose: { showingSettings = false })
            } else {
                content
                // Before sign-in there is no tracker to describe or start: the row
                // said "Tracker stopped · Start tracking" to someone with no account.
                if store.phase != .needsToken {
                    trackerRow
                }
                Divider().padding(.vertical, 8)
                actions
            }
        }
        .padding(12)
        .frame(width: 320)
        // The poll loop speeds up to 3s while this is on screen and drops back to 15s
        // when it closes. `.window` style has no isPresented binding on macOS 13, so the
        // content's own lifecycle is the signal.
        .onAppear {
            store.popoverIsOpen = true
            tracker.refreshLocalStatus()
        }
        .onDisappear { store.popoverIsOpen = false }
    }

    /// First run itself is owned by `OnboardingWindowController`'s standalone, centred
    /// window now — this only ever falls back to `OnboardingView` (the plain token
    /// field) for a *returning* user who cleared their token in Settings.
    @ViewBuilder
    private var content: some View {
        switch store.phase {
        case .needsToken:
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 7) {
                    BrandMark(size: 16)
                    Text("Connect this Mac").font(.system(size: 14, weight: .semibold))
                }
                OnboardingView(store: store, settings: settings, tracker: tracker)
            }
        case .loading:
            loadingSkeleton
        case .failed(let error):
            errorState(error)
        case .loaded(let me):
            loadedContent(me)
        }
    }

    /// Local daemon state — independent of `me.tracker.connected` (a fact about the
    /// server's last accepted heartbeat, not about a process running on this machine).
    private var trackerRow: some View {
        VStack(alignment: .leading, spacing: 3) {
            Divider().padding(.bottom, 8)
            HStack(spacing: 6) {
                // Lumi: presence is the only thing in this UI allowed to be green. A
                // green dot here made "a process is running on this Mac" look like "you
                // are actively coding" — two unrelated facts sharing one hue. Liveness
                // is now a filled/hollow neutral glyph; `PresenceDot` keeps the colour.
                Image(systemName: trackerSymbol)
                    .font(.system(size: 9))
                    .foregroundStyle(.secondary)
                Text(trackerStatusLabel)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    // FC2's caveat lives here as a tooltip: always one hover away,
                    // no longer a permanent paragraph under a status line.
                    .help(trackerStatusNote ?? "")
                Spacer(minLength: 0)
                if !tracker.isTrackAtLoginEnabled {
                    Button(tracker.isBusy ? "Starting\u{2026}" : "Start") { Task { await startTrackingFromRow() } }
                        .buttonStyle(.borderless)
                        .font(.system(size: 11))
                        .disabled(tracker.isBusy)
                }
            }
            if tracker.connectionState == .authRejected, let note = trackerStatusNote {
                Text(note)
                    .font(.system(size: 10))
                    .foregroundStyle(.tertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.top, 12)
    }

    private var trackerSymbol: String {
        switch tracker.connectionState {
        case .authRejected: return "exclamationmark.circle"
        case .connected: return "circle.fill"
        case .disconnected: return "circle.dotted"
        case .unknown: return "circle"
        }
    }

    /// FC2: this row is about the *daemon on this Mac* and its transport, never about AI
    /// activity — that story belongs to `nowBlock`, which reads `presence`. "Connected"
    /// here means the server accepted a recent connection-v1 receipt and nothing more.
    ///
    /// A snapshot older than the transport TTL, or one with no live pid behind it, is
    /// reported as unknown rather than as whatever it last happened to say.
    private var trackerStatusLabel: String {
        switch tracker.connectionState {
        case .authRejected:
            return "Signed out on this Mac"
        case .connected:
            return "Counting \u{00B7} \(lastUpdatedSuffix)"
        case .disconnected:
            return "Can\u{2019}t reach VibeHub"
        case .unknown:
            return tracker.isRunning ? "Running" : "Not counting"
        }
    }

    private var trackerStatusNote: String? {
        switch tracker.connectionState {
        case .authRejected:
            return "Reconnect this Mac in Settings."
        case .connected:
            // The one sentence that stops a transport tick reading as AI usage.
            return "This Mac checked in recently. Not the same as an AI tool in use."
        case .disconnected, .unknown:
            return nil
        }
    }

    private var lastUpdatedSuffix: String {
        guard let updatedAt = tracker.localStatus?.lastConnectionSeenAt ?? tracker.localStatus?.updatedAt,
              let date = Format.parseISO8601(updatedAt) else { return "just now" }
        let elapsed = Format.elapsedShort(since: date, now: store.now)
        return date.timeIntervalSince(store.now) > -60 ? elapsed : "\(elapsed) ago"
    }

    /// `enableTrackAtLogin` owns both halves of Start now — the tracker's LaunchAgent and
    /// the app's own login registration (N7) — so this no longer sets the login item
    /// separately. Doing it here as well was how the two could disagree: the app could
    /// end up registered for login while the agent install failed.
    private func startTrackingFromRow() async {
        _ = await tracker.enableTrackAtLogin()
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
                HStack(spacing: 8) {
                    Text(Format.elapsedShort(since: activity.since, now: store.now))
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                    // R5: an unaliased folder reads "Private project" — offer the fix
                    // right there instead of letting it look broken.
                    if Format.isPrivateProject(activity.project), !naming {
                        Button("Name it") { naming = true; nameNote = nil }
                            .buttonStyle(.link)
                            .font(.system(size: 11))
                    }
                }
                if naming { nameEditor }
                if let nameNote {
                    Text(nameNote).font(.system(size: 11)).foregroundStyle(.secondary)
                }
            } else {
                // Empty state: one sentence. The action that resolves it (Start) is
                // already in the tracker row below — no second button here.
                Text(me.tracker.connected ? "Nothing open right now." : "Not counting on this Mac.")
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
            }
        }
    }

    /// Folder name (stays on this Mac) → the name friends see.
    private var nameEditor: some View {
        VStack(alignment: .leading, spacing: 6) {
            TextField("Folder, e.g. my-app", text: $folderName)
            TextField("Show as (optional)", text: $projectName)
                .onSubmit { Task { await saveProjectName() } }
            HStack(spacing: 10) {
                Button(tracker.isBusy ? "Saving\u{2026}" : "Save") { Task { await saveProjectName() } }
                    .disabled(tracker.isBusy || folderName.trimmingCharacters(in: .whitespaces).isEmpty)
                Button("Cancel") { naming = false }
                    .buttonStyle(.link)
                    .foregroundStyle(.secondary)
            }
            .font(.system(size: 11))
        }
        .textFieldStyle(.roundedBorder)
        .font(.system(size: 12))
        .padding(.top, 2)
    }

    private func saveProjectName() async {
        let folder = folderName.trimmingCharacters(in: .whitespaces)
        let shown = projectName.trimmingCharacters(in: .whitespaces)
        switch await tracker.nameProject(folder: folder, as: shown.isEmpty ? folder : shown) {
        case .success:
            naming = false
            folderName = ""
            projectName = ""
            nameNote = "Saved. Shows up in a minute."
            store.wake()
        case .failure(let error):
            nameNote = error.errorDescription
        }
    }

    private func todayBlock(_ me: TrackerMe) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            SectionLabel(text: "Today")
            HStack(alignment: .top, spacing: 0) {
                stat(Format.compactDuration(seconds: store.liveActiveSeconds ?? me.today.activeSeconds), "active")
                Spacer(minLength: 8)
                // `tokens` is nullable on the wire (checkpoint §M.1): null means the
                // day's activity came only from tools that report no counts. B7: render
                // "tokens not reported" — never 0, never an estimate. Same em-dash rule as
                // ≈$ below, with the words in the label so the dash cannot read as a glitch.
                stat(Format.optionalCount(me.today.tokens), Format.tokensLabel(me.today.tokens),
                     // Cache reads: real, but secondary — never folded into "tokens".
                     secondary: Format.cachedLine(me.today.cachedTokens))
                Spacer(minLength: 8)
                // `estimatedUsd` now ships (`server/src/lib/token-pricing.ts`), so the
                // slot is always ≈$ — and always present. `null` means "no verified
                // price for today's models" and renders as an em-dash, never as $0.00
                // and never by swapping in a different statistic, which made the row
                // silently mean two different things on different days.
                stat(Format.optionalUsd(me.today.estimatedUsd), "\u{2248} spend")
            }
        }
    }

    private func stat(_ value: String, _ label: String, secondary: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(value)
                .font(.system(size: 15, weight: .medium))
                .monospacedDigit()
            Text(label)
                .font(.system(size: 10))
                .foregroundStyle(.tertiary)
            if let secondary {
                Text(secondary)
                    .font(.system(size: 10))
                    .foregroundStyle(.tertiary)
                    .monospacedDigit()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func friendsBlock(_ me: TrackerMe) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionLabel(text: me.friendsOnline.count == 1 ? "1 friend online" : "\(me.friendsOnline.count) friends online")
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
            // Three rows. "Go online" opened the web connect sheet — on a Mac whose app
            // *is* the connector it read like a presence switch; Start lives in the
            // tracker row. Copy Token moved to Settings → Account.
            ActionRow(title: "Open VibeHub", symbol: "arrow.up.forward.app") {
                open(settings.webUrl)
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
