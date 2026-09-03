import Foundation

// Reads (never writes) ~/.vibehub/status.json and reports the current TrackerStatus.
//
// Poll-based, not DispatchSourceFileSystemObject: the tracker writes atomically via
// temp-file-then-rename (docs/BUILD_PLAN.md §6 item 4), which swaps the file's inode on
// every update. A DispatchSource watching an open file descriptor keeps watching the
// old, now-unlinked inode after a rename and stops seeing further changes — it would
// silently go stale after the first update. A 5s poll timer has no such failure mode
// and comfortably keeps up with the tracker's default 30s heartbeat interval
// (docs/ARCHITECTURE.md §4.2). See macos/README.md for the same note.
final class StatusFileWatcher {
    static let pollInterval: TimeInterval = 5.0

    private let fileURL: URL
    private let onUpdate: (TrackerStatus) -> Void
    private var timer: Timer?
    private let decoder = JSONDecoder()

    init(onUpdate: @escaping (TrackerStatus) -> Void) {
        let home = FileManager.default.homeDirectoryForCurrentUser
        self.fileURL = home.appendingPathComponent(".vibehub/status.json")
        self.onUpdate = onUpdate
    }

    func start() {
        poll()
        let timer = Timer.scheduledTimer(withTimeInterval: Self.pollInterval, repeats: true) { [weak self] _ in
            self?.poll()
        }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    private func poll() {
        onUpdate(readStatus())
    }

    private func readStatus() -> TrackerStatus {
        guard let data = try? Data(contentsOf: fileURL) else {
            // Missing file means the tracker hasn't run yet, or hasn't written a first
            // snapshot — not an error condition for this app.
            return .unavailable
        }
        guard let contents = try? decoder.decode(StatusFileContents.self, from: data) else {
            FileHandle.standardError.write(
                Data("VibeHubMenuBar: could not decode \(fileURL.path)\n".utf8)
            )
            return .unavailable
        }
        return TrackerStatus(decoding: contents)
    }
}
