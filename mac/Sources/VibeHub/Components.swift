import AppKit
import SwiftUI

/// Presence dot. Filled green only when actually active; grey when idle; a hollow ring
/// when offline. Shape carries the meaning as much as the colour does, so the state is
/// still readable in greyscale and for colour-blind users — the one deliberate hue in
/// an otherwise monochrome surface.
struct PresenceDot: View {
    let status: PresenceStatus
    var size: CGFloat = 8

    var body: some View {
        Group {
            switch status {
            case .active:
                Circle().fill(Color.green)
            case .idle:
                Circle().fill(Color.secondary)
            case .offline:
                Circle().strokeBorder(Color.secondary.opacity(0.6), lineWidth: 1)
            }
        }
        .frame(width: size, height: size)
        .accessibilityLabel(Format.statusLabel(status))
    }
}

/// Remote avatar with a monochrome initials fallback — used while loading, when the URL
/// is nil (fresh account), and when the image fails.
struct Avatar: View {
    let url: String?
    let name: String
    var size: CGFloat = 28

    private var initial: String {
        String(name.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased()
    }

    var body: some View {
        Group {
            if let url, let parsed = URL(string: url) {
                AsyncImage(url: parsed) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    default:
                        placeholder
                    }
                }
            } else {
                placeholder
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(Circle().strokeBorder(Color.primary.opacity(0.12), lineWidth: 0.5))
    }

    private var placeholder: some View {
        ZStack {
            Color.secondary.opacity(0.15)
            Text(initial)
                .font(.system(size: size * 0.42, weight: .medium, design: .rounded))
                .foregroundStyle(.secondary)
        }
    }
}

/// Shape-matched loading placeholder. Shapes, never a spinner — a spinner tells the user
/// nothing about what is arriving, and the layout must not jump when it resolves.
struct SkeletonBar: View {
    var width: CGFloat
    var height: CGFloat = 10

    @State private var shimmer = false

    var body: some View {
        RoundedRectangle(cornerRadius: height / 2, style: .continuous)
            .fill(Color.secondary.opacity(shimmer ? 0.22 : 0.11))
            .frame(width: width, height: height)
            .animation(.easeInOut(duration: 1.4).repeatForever(autoreverses: true), value: shimmer)
            .onAppear { shimmer = true }
            .accessibilityHidden(true)
    }
}

/// Small uppercase section heading — the popover's only structural chrome.
struct SectionLabel: View {
    let text: String

    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 10, weight: .semibold))
            .tracking(0.6)
            .foregroundStyle(.tertiary)
    }
}

/// Full-width row that looks like a menu item, for the action list at the foot.
struct ActionRow: View {
    let title: String
    let symbol: String
    var action: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: symbol)
                    .font(.system(size: 12))
                    .frame(width: 16)
                Text(title).font(.system(size: 13))
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .contentShape(Rectangle())
            // Hover is a lightness shift, never a colour change.
            .background(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(Color.primary.opacity(hovering ? 0.08 : 0))
            )
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}

/// The one primary action per screen, in the house style: an ink plate with a paper
/// label — no hue, so presence stays the only colour in the product
/// (`.borderedProminent` tints with the system accent). Pressed = scale 0.97 within
/// 120ms, the press state Lumi's review found missing on the onboarding buttons (N6);
/// `.borderedProminent` has no press transform on macOS, only a tint shift. Reduced
/// motion keeps the lightness change and drops the scale.
struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(Color(nsColor: .windowBackgroundColor))
            .padding(.horizontal, 18)
            .frame(minHeight: 32)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(Color.primary.opacity(configuration.isPressed ? 0.85 : 1))
            )
            .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .opacity(isEnabled ? 1 : 0.45)
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.97 : 1)
            .animation(reduceMotion ? nil : Animation.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

/// The quiet partner to `PrimaryButtonStyle`: same size and press, a soft plate
/// instead of ink — for the second choice on a screen that has one.
struct SecondaryButtonStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(.primary)
            .padding(.horizontal, 18)
            .frame(minHeight: 32)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(Color.primary.opacity(configuration.isPressed ? 0.14 : 0.08))
            )
            .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.97 : 1)
            .animation(reduceMotion ? nil : Animation.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}
