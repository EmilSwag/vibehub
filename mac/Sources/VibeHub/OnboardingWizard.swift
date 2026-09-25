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

    init(store: StatusStore, settings: AppSettings, tracker: TrackerManager, initialStep: OnboardingStep? = nil, onFinished: @escaping () -> Void) {
        self.store = store
        self.settings = settings
        self.tracker = tracker
        self.onFinished = onFinished
        // A handoff/deep link may already have landed before this view was ever built.
        _step = State(initialValue: initialStep ?? (store.token == nil ? .welcome : .startTracking))
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

    /// Every step has the same skeleton — a visual, a title, one line, one primary
    /// action at the foot — so the eye learns where to look on step one and never has
    /// to look again.
    private func stepLayout<Visual: View, Extra: View, Actions: View>(
        title: String,
        line: String,
        @ViewBuilder visual: () -> Visual,
        @ViewBuilder extra: () -> Extra,
        @ViewBuilder actions: () -> Actions
    ) -> some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            visual().frame(height: 64)
            Text(title)
                .font(.system(size: 22, weight: .semibold))
                .padding(.top, 20)
            Text(line)
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 6)
            extra().padding(.top, 22)
            Spacer(minLength: 0)
            actions()
        }
        .frame(maxWidth: .infinity)
    }

    private var welcomeStep: some View {
        // The real mark (Lumi, first-start review) — the same figure as the app icon
        // and the menu bar, not an SF Symbol standing in for it.
        stepLayout(
            title: "VibeHub",
            line: "Your coding presence, right beside the notch.",
            visual: { BrandMark(size: 52) },
            extra: { EmptyView() },
            actions: { primaryButton("Get Started") { advance(to: .token) } }
        )
    }

    private var tokenStep: some View {
        stepLayout(
            title: "Connect this Mac",
            line: "Approve it in your browser. No typing.",
            visual: { stepSymbol("link") },
            extra: {
                OnboardingView(store: store, settings: settings, tracker: tracker, alignment: .center, onSaved: { viaKeyboard in
                    // Return in the token field advances without motion (N6).
                    advance(to: .startTracking, animated: !viaKeyboard)
                })
            },
            actions: { EmptyView() }
        )
    }

    private var startTrackingStep: some View {
        // No login-item toggle here, and no `.onAppear` side effect: nothing installs
        // itself until the button is pressed. `TrackerManager.enableTrackAtLogin` owns
        // both halves (N7), so consent and effect happen in one place (FC5).
        stepLayout(
            title: "Start tracking",
            line: "Runs quietly in the background, even after a restart.",
            visual: { stepSymbol("waveform.path.ecg") },
            extra: {
                VStack(spacing: 14) {
                    HStack {
                        Text("Show the island").font(.system(size: 13))
                        Spacer()
                        Toggle("Show the island", isOn: Binding(
                            get: { settings.islandMode != .off },
                            set: { enabled in settings.islandMode = enabled ? .auto : .off }
                        ))
                        .labelsHidden()
                        .toggleStyle(.switch)
                        .controlSize(.small)
                    }
                    .padding(.horizontal, 14)
                    .frame(width: 280, height: 40)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.primary.opacity(0.05)))

                    // Progress appears only once there is progress — two grey ticks
                    // before anything has happened read as disabled options.
                    if tracker.startProgress != .idle {
                        VStack(alignment: .leading, spacing: 6) {
                            progressTick("Signing in", state: signInTickState)
                            progressTick("Starting the tracker", state: trackerTickState)
                        }
                    }

                    if case .failed(let message) = tracker.startProgress {
                        Label(message, systemImage: "exclamationmark.circle")
                            .font(.system(size: 11, weight: .medium))
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: 320)
                    }
                }
            },
            actions: {
                primaryButton(primaryLabel) { Task { await startTracking() } }
                    .disabled(tracker.isBusy)
            }
        )
    }

    private var doneStep: some View {
        stepLayout(
            title: "You\u{2019}re live",
            line: "Hover the notch any time for the details.",
            visual: {
                // Hung from a strip of menu bar, so the preview reads as "at the top of
                // the screen" rather than a black lozenge floating in a window.
                IslandPreview(store: store)
                    .frame(width: 360, height: 60, alignment: .top)
                    .background(alignment: .top) {
                        Rectangle().fill(Color.primary.opacity(0.07)).frame(height: 32)
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            },
            extra: { EmptyView() },
            actions: {
                HStack(spacing: 10) {
                    Button("Done", action: onFinished)
                        .buttonStyle(SecondaryButtonStyle())
                    primaryButton("Open VibeHub") {
                        NSWorkspace.shared.open(settings.webUrl)
                        onFinished()
                    }
                }
            }
        )
    }

    /// A symbol on a soft disc — the visual slot for steps that have no picture.
    private func stepSymbol(_ name: String) -> some View {
        Image(systemName: name)
            .font(.system(size: 24, weight: .medium))
            .foregroundStyle(.primary)
            .frame(width: 60, height: 60)
            .background(Circle().fill(Color.primary.opacity(0.06)))
    }

    // MARK: - Start tracking progress

    private var primaryLabel: String {
        switch tracker.startProgress {
        case .idle: return "Start Tracking"
        case .failed: return "Try Again"
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
