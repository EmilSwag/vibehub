import SwiftUI

/// First run, one screen (L3, `vibehub-qa-fix.md`): mark + Connect → browser pairing →
/// "You're live ✓" → the window gets out of the way on its own.
///
/// `starting` is the few seconds between an approved browser and a running tracker —
/// and, when that fails, the one place a "Try Again" lives.
enum OnboardingStep: Int, CaseIterable {
    case connect, starting, live
}

/// Hosted by `OnboardingWindowController` in a small centred `NSWindow`.
///
/// A token arriving from *any* source — the browser, a pasted code, a deep link —
/// lands on `TrackerManager.connectedUsername`, so this view doesn't care which fired.
/// Pressing Connect is the consent to start: the line under the headline says so, and
/// `enableTrackAtLogin` is the one call that installs anything (FC5, N7).
struct OnboardingWizard: View {
    @ObservedObject var store: StatusStore
    @ObservedObject var settings: AppSettings
    @ObservedObject var tracker: TrackerManager
    /// `live: true` once the celebration has played (the controller then pulses the
    /// island and points at the menu bar); `false` for a close without connecting.
    var onFinished: (_ live: Bool) -> Void
    /// False in the QA harness, which renders a step without running it.
    var autoStart = true

    @State private var step: OnboardingStep
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// How long "You're live" stays before the window dismisses itself.
    static let celebrationSeconds: Double = 2.4

    init(store: StatusStore, settings: AppSettings, tracker: TrackerManager, initialStep: OnboardingStep? = nil,
         autoStart: Bool = true, onFinished: @escaping (_ live: Bool) -> Void) {
        self.store = store
        self.settings = settings
        self.tracker = tracker
        self.onFinished = onFinished
        self.autoStart = autoStart
        _step = State(initialValue: initialStep ?? (store.token == nil ? .connect : .starting))
    }

    var body: some View {
        content
            .padding(32)
            .frame(width: 420, height: 400)
            .onChange(of: tracker.connectedUsername) { username in
                guard username != nil, step == .connect else { return }
                begin()
            }
            .task {
                // A token already in the Keychain (returning user) skips straight on.
                guard autoStart, step == .starting else { return }
                await startTracking()
            }
    }

    @ViewBuilder
    private var content: some View {
        switch step {
        case .connect: connectStep
        case .starting: startingStep
        case .live: liveStep
        }
    }

    /// Same skeleton every state: visual, headline (≤ 5 words), one line, action.
    private func layout<Visual: View, Action: View>(
        title: String,
        line: String,
        @ViewBuilder visual: () -> Visual,
        @ViewBuilder action: () -> Action
    ) -> some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            visual().frame(height: 72)
            Text(title)
                .font(.system(size: 24, weight: .semibold))
                .padding(.top, 22)
            Text(line)
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .padding(.top, 6)
            action().padding(.top, 26)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity)
    }

    private var connectStep: some View {
        layout(
            title: "Connect this Mac",
            line: "Counts your AI coding time. Starts with your Mac.",
            visual: { BrandMark(size: 56) },
            action: {
                OnboardingView(store: store, settings: settings, tracker: tracker, alignment: .center, large: true,
                               onSaved: { _ in begin() })
            }
        )
    }

    private var startingStep: some View {
        let failure: String? = {
            if case .failed(let message) = tracker.startProgress { return message }
            return nil
        }()
        return layout(
            title: failure == nil ? "Almost there\u{2026}" : "One more step",
            line: failure ?? "Setting things up.",
            visual: {
                if failure == nil {
                    ProgressView().controlSize(.large)
                } else {
                    Image(systemName: "exclamationmark.circle")
                        .font(.system(size: 34, weight: .regular))
                        .foregroundStyle(.secondary)
                }
            },
            action: {
                if failure != nil {
                    Button("Try Again") { Task { await startTracking() } }
                        .buttonStyle(PrimaryButtonStyle(large: true))
                        .disabled(tracker.isBusy)
                }
            }
        )
    }

    private var liveStep: some View {
        layout(
            title: "You\u{2019}re live",
            line: settings.islandMode != .off && AppSettings.hasNotchedScreen
                ? "Your time counts now. Peek at the notch."
                : "Your time counts now.",
            visual: { LiveCheck(size: 72, animated: autoStart) },
            action: { EmptyView() }
        )
        // Celebrate, then get out of the way — a click just gets there sooner.
        .contentShape(Rectangle())
        .onTapGesture { finish() }
        .task {
            guard autoStart else { return }
            try? await Task.sleep(nanoseconds: UInt64(Self.celebrationSeconds * 1_000_000_000))
            finish()
        }
    }

    @State private var finished = false

    private func finish() {
        guard !finished else { return }
        finished = true
        onFinished(true)
    }

    private func begin() {
        store.wake()
        go(to: .starting)
        Task { await startTracking() }
    }

    private func startTracking() async {
        // Already running (e.g. the agent survived a reinstall): nothing to install.
        if tracker.isTrackAtLoginEnabled && !settings.userDisabledTracking {
            go(to: .live)
            return
        }
        let result = await tracker.enableTrackAtLogin()
        if case .success = result {
            store.wake()
            go(to: .live)
        }
    }

    private func go(to next: OnboardingStep) {
        guard !reduceMotion else {
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) { step = next }
            return
        }
        withAnimation(.easeOut(duration: 0.22)) { step = next }
    }
}

/// The success mark: a ring draws itself, then the tick, then a small settle. Ink, not
/// green — presence is the product's only colour (docs/DESIGN.md). Reduced motion shows
/// the finished mark at once.
struct LiveCheck: View {
    var size: CGFloat = 72
    /// QA harness: render the finished frame without waiting for the animation.
    var animated = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var ring: CGFloat = 0
    @State private var tick: CGFloat = 0
    @State private var scale: CGFloat = 0.8

    var body: some View {
        ZStack {
            Circle()
                .fill(Color.primary.opacity(0.06))
            Circle()
                .trim(from: 0, to: ring)
                .stroke(Color.primary, style: StrokeStyle(lineWidth: size * 0.05, lineCap: .round))
                .rotationEffect(.degrees(-90))
            TickShape()
                .trim(from: 0, to: tick)
                .stroke(Color.primary, style: StrokeStyle(lineWidth: size * 0.07, lineCap: .round, lineJoin: .round))
                .frame(width: size * 0.42, height: size * 0.32)
        }
        .frame(width: size, height: size)
        .scaleEffect(scale)
        .accessibilityLabel("Connected")
        .onAppear {
            guard animated, !reduceMotion else {
                ring = 1; tick = 1; scale = 1
                return
            }
            withAnimation(.easeOut(duration: 0.45)) { ring = 1 }
            withAnimation(.easeOut(duration: 0.28).delay(0.35)) { tick = 1 }
            withAnimation(.spring(response: 0.35, dampingFraction: 0.55).delay(0.05)) { scale = 1 }
        }
    }
}

private struct TickShape: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.midY + rect.height * 0.05))
        path.addLine(to: CGPoint(x: rect.minX + rect.width * 0.36, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        return path
    }
}
