import SwiftUI

enum OnboardingStep: Int, CaseIterable {
    case welcome, token, startTracking, done
}

private enum TickState: Equatable {
    case pending, active, done
}

/// The standalone, centred first-run window's content (`OnboardingWindowController`
/// hosts this in a real ~460x520 `NSWindow`, not the menu-bar popover): Welcome ->
/// Token -> Start tracking -> Done.
///
/// A token arriving mid-flow from *any* source — a `vibehub://connect` click, or an
/// installer handoff racing app launch — auto-advances past whichever step it lands
/// on: `TrackerManager.connect(token:apiUrl:webUrl:)` is the one shared flow behind a
/// pasted token, a deep link and a handoff alike, and `connectedUsername` is its one
/// shared success signal, so this view doesn't need to know or care which source fired.
struct OnboardingWizard: View {
    @ObservedObject var store: StatusStore
    @ObservedObject var settings: AppSettings
    @ObservedObject var tracker: TrackerManager
    var onFinished: () -> Void

    @State private var step: OnboardingStep
    /// False after a keyboard-initiated or reduced-motion advance, so the progress dots
    /// stay still along with the content (N6: no animation on a keyboard-driven step).
    @State private var animateChrome = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(store: StatusStore, settings: AppSettings, tracker: TrackerManager, onFinished: @escaping () -> Void) {
        self.store = store
        self.settings = settings
        self.tracker = tracker
        self.onFinished = onFinished
        // A handoff/deep link may already have landed before this view was ever built.
        _step = State(initialValue: store.token == nil ? .welcome : .startTracking)
    }

    var body: some View {
        VStack(spacing: 20) {
            content
            dots
        }
        .padding(32)
        .frame(width: 460, height: 520)
        .onChange(of: tracker.connectedUsername) { username in
            guard username != nil, step == .welcome || step == .token else { return }
            store.wake()
            advance(to: .startTracking)
        }
    }

    @ViewBuilder
    private var content: some View {
        switch step {
        case .welcome: welcomeStep
        case .token: tokenStep
        case .startTracking: startTrackingStep
        case .done: doneStep
        }
    }

    private var welcomeStep: some View {
        VStack(spacing: 14) {
            Spacer(minLength: 0)
            // The real mark (Lumi, first-start review) — the same figure as the app
            // icon and the menu bar, not an SF Symbol standing in for it.
            BrandMark(size: 44)
            Text("VibeHub").font(.system(size: 22, weight: .semibold))
            Text("Your AI-coding presence, in the menu bar and the notch.")
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            primaryButton("Continue") { advance(to: .token) }
        }
    }

    private var tokenStep: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Connect your account").font(.system(size: 16, weight: .semibold))
            OnboardingView(store: store, settings: settings, tracker: tracker, onSaved: { viaKeyboard in
                // Return in the token field advances without motion (N6).
                advance(to: .startTracking, animated: !viaKeyboard)
            })
            Spacer(minLength: 0)
        }
    }

    private var startTrackingStep: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Start tracking").font(.system(size: 16, weight: .semibold))
            Text("Runs quietly in the background and restarts itself after a reboot.")
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            // No "Background at login" toggle here any more. It registered the app as a
            // login item the moment this step appeared — before the user had agreed to
            // anything — and duplicated a decision "Start tracking" already makes.
            // `TrackerManager.enableTrackAtLogin` now owns both halves (N7), so consent
            // and effect happen in the same place, on the same button.
            Toggle("Show the island", isOn: Binding(
                get: { settings.islandMode != .off },
                set: { enabled in settings.islandMode = enabled ? .auto : .off }
            ))

            VStack(alignment: .leading, spacing: 6) {
                progressTick("Sign in", state: signInTickState)
                progressTick("Start the tracker", state: trackerTickState)
            }
            .padding(.top, 4)

            if case .failed(let message) = tracker.startProgress {
                HStack(spacing: 8) {
                    Text(message).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(2)
                    Button("Retry") { Task { await startTracking() } }.buttonStyle(.borderless)
                }
            }

            Spacer(minLength: 0)
            HStack(spacing: 10) {
                primaryButton(primaryLabel) { Task { await startTracking() } }
                    .disabled(tracker.isBusy)
                // Lumi: the button changed its label but nothing else moved, so the
                // seconds spent in `launchctl bootstrap` looked like a dead click.
                if tracker.isBusy {
                    ProgressView().controlSize(.small)
                }
            }
        }
        // Deliberately no `.onAppear` side effect. The previous version called
        // `setLaunchAtLogin(true)` here, which registered a login item merely because
        // the user reached this step — and would silently re-register it for someone who
        // had turned tracking off and come back (FC5, retained Off). Nothing installs
        // itself until the button below is pressed.
    }

    private var doneStep: some View {
        VStack(spacing: 16) {
            Spacer(minLength: 0)
            Text("You're live.").font(.system(size: 20, weight: .semibold))
            IslandPreview(store: store)
            Spacer(minLength: 0)
            HStack(spacing: 12) {
                Button("Close", action: onFinished)
                    .buttonStyle(.bordered)
                primaryButton("Open VibeHub") {
                    NSWorkspace.shared.open(settings.webUrl)
                    onFinished()
                }
            }
        }
    }

    // MARK: - Start tracking progress

    private var primaryLabel: String {
        switch tracker.startProgress {
        case .idle, .failed: return "Start tracking"
        case .signingIn: return "Signing in\u{2026}"
        case .startingTracker: return "Starting tracker\u{2026}"
        case .done: return "Started"
        }
    }

    private var signInTickState: TickState {
        switch tracker.startProgress {
        case .idle, .failed: return .pending
        case .signingIn: return .active
        case .startingTracker, .done: return .done
        }
    }

    private var trackerTickState: TickState {
        switch tracker.startProgress {
        case .startingTracker: return .active
        case .done: return .done
        case .idle, .signingIn, .failed: return .pending
        }
    }

    private func progressTick(_ title: String, state: TickState) -> some View {
        HStack(spacing: 6) {
            switch state {
            case .pending:
                Image(systemName: "circle").font(.system(size: 11)).foregroundStyle(.tertiary)
            case .active:
                ProgressView().controlSize(.small)
            case .done:
                // Lumi: presence is the only green in this product. A green tick here
                // competed with `PresenceDot` for the same meaning, in a window that
                // shows a presence dot moments later. `.secondary` keeps the tick
                // legible as "finished" without claiming the presence colour.
                Image(systemName: "checkmark.circle.fill").font(.system(size: 11)).foregroundStyle(.secondary)
            }
            // Explicit `AnyShapeStyle` on both arms: a bare `.tertiary : .primary` ternary
            // has no single type the generic `foregroundStyle` can infer.
            Text(title)
                .font(.system(size: 12))
                .foregroundStyle(state == .pending ? AnyShapeStyle(.tertiary) : AnyShapeStyle(.primary))
        }
    }

    private func startTracking() async {
        let result = await tracker.enableTrackAtLogin()
        if case .success = result { advance(to: .done) }
    }

    // MARK: - Chrome

    /// `animated: false` for a step the keyboard drove (Return in the token field): the
    /// user's attention is already on the next thing, and motion there reads as the app
    /// catching up rather than responding. Reduced motion makes every advance instant,
    /// chrome included (emil design-eng: reduce means instant transitions).
    private func advance(to next: OnboardingStep, animated: Bool = true) {
        let shouldAnimate = animated && !reduceMotion
        animateChrome = shouldAnimate
        guard shouldAnimate else {
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) { step = next }
            return
        }
        withAnimation(.easeOut(duration: 0.2)) { step = next }
    }

    /// One primary action per step, in the house style with a real press state —
    /// `PrimaryButtonStyle` in `Components.swift` (N6, Lumi's first-start review).
    private func primaryButton(_ title: String, action: @escaping () -> Void) -> some View {
        Button(title, action: action).buttonStyle(PrimaryButtonStyle())
    }

    private var dots: some View {
        HStack(spacing: 5) {
            ForEach(OnboardingStep.allCases, id: \.self) { candidate in
                Capsule()
                    .fill(Color.primary.opacity(candidate == step ? 0.8 : 0.2))
                    .frame(width: candidate == step ? 14 : 6, height: 6)
            }
        }
        .animation(animateChrome ? Animation.easeOut(duration: 0.2) : nil, value: step)
    }
}
