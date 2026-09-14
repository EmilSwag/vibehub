// The text a user pastes into their AI tool to set the VibeHub tracker up.
// `cursor`, `claude-code`, `codex` and `quadcode` can run shell commands; `chatgpt`
// cannot, so it gets a walk-through instead.
//
// Installing and starting are two separate consents. A Claude Code auto-mode
// classifier refused the old prompt, and it was right to: one paste downloaded the
// tracker *and* spawned a background daemon. So the prompt installs only, explains
// what a background start does, asks, and waits — and states what to do when the
// agent's own safety layer blocks a step, because a prompt that leaves the denial
// case undefined invites a model to improvise a bypass.
//
// Pinned by lib/__checks__/connectPrompt.check.ts.

export type ConnectPromptTarget = "cursor" | "claude-code" | "codex" | "quadcode" | "chatgpt";

export type InstallOs = "mac" | "windows";

/** The tracker's own verbs. `login` is deliberately absent: it is the only one that
 *  takes a token, and no command this file emits after install may carry one. */
export type TrackerVerb = "start" | "status" | "stop";

// Where install.sh and install.ps1 put the single-file tracker — and, character for
// character, what those installers print on completion. The two sides cannot share a
// source (one is shell, one is TypeScript), so they are kept identical by hand and
// pinned in the check; `install.sh` builds its from APP_DIR="$HOME/.vibehub/app" and
// `install.ps1` from Join-Path $HOME ".vibehub\app".
//
// Both quote the path and both go through `$HOME` rather than `~`. Quoting matters:
// an unquoted `~/.vibehub/...` word-splits on a home directory containing a space,
// and quoting the tilde ("~/...") would stop it expanding at all — so `"$HOME/..."`
// is the only form that is both expanded and safe.
const BIN_POSIX = '"$HOME/.vibehub/app/vibehub-tracker.cjs"';
const BIN_POWERSHELL = '"$HOME\\.vibehub\\app\\vibehub-tracker.cjs"';

/**
 * One tracker command for one OS — `start`, `status` or `stop`.
 *
 * Never carries the device token: the token is written to ~/.vibehub/config.json at
 * install time, and these three read it from there.
 */
export function buildTrackerCommand(os: InstallOs, verb: TrackerVerb): string {
  return `node ${os === "windows" ? BIN_POWERSHELL : BIN_POSIX} ${verb}`;
}

export const buildStartCommand = (os: InstallOs): string => buildTrackerCommand(os, "start");
export const buildStatusCommand = (os: InstallOs): string => buildTrackerCommand(os, "status");
export const buildStopCommand = (os: InstallOs): string => buildTrackerCommand(os, "stop");

/**
 * What the person is agreeing to when they allow the start. Said once, in the prompt
 * and in the sheet, in the same words — a consent described two ways is not one
 * consent. It never claims to read no file contents: the Claude Code, Codex and
 * Quadcode adapters tail session JSONL, and take only ids, the model and token counts
 * from it, so the true statement is about what is *sent*.
 */
export const BACKGROUND_START_MEANS =
  "Runs in the background until you stop it. Reads activity metadata and window titles from your AI tools; sends tool, model, project name, timestamps and token counts to VibeHub — never your code or prompts. No OS autostart.";

/**
 * The install one-liner for one OS. Sets VIBEHUB_API_URL explicitly so the command
 * works against any deployment, not just install.sh/.ps1's baked-in default. Shared by
 * the prompt and the "Do it manually" block so the two never drift.
 */
export function buildInstallCommand(os: InstallOs, token: string, apiUrl: string, webUrl: string): string {
  return os === "windows"
    ? `$env:VIBEHUB_TOKEN="${token}"; $env:VIBEHUB_API_URL="${apiUrl}"; irm ${webUrl}/tracker/install.ps1 | iex`
    : `curl -fsSL ${webUrl}/tracker/install.sh | VIBEHUB_API_URL="${apiUrl}" bash -s -- ${token}`;
}

/**
 * The one pass/fail check, per OS. Per OS because a single POSIX line was handed to
 * Windows users too, where `node` receives a literal `~` and fails on a path that does
 * not exist.
 */
export function buildVerifyLine(os: InstallOs): string {
  return `Run ${buildStatusCommand(os)} — it must print "Connected: yes".`;
}

/**
 * What an agent must do when its own safety tooling refuses a step.
 *
 * "A blocked step is a normal outcome" is load-bearing: without it the refusal reads
 * as an obstacle, and an obstacle is the kind of thing a capable model routes around.
 * It reprints no command: it points back at the step that was blocked, so the
 * token still appears exactly twice in the whole prompt.
 */
const BLOCKED_CLAUSE =
  "If your safety rules or approval prompts block step 2 or step 5, stop automating: say so and show me that step's command to run in my own terminal. Do not retry with other flags, shells or wrapper scripts, and do not edit any permission, allow-list or settings file. A blocked step is a normal outcome, not a problem to solve.";

/** Builds the prompt for `target`. */
export function buildConnectPrompt(target: ConnectPromptTarget, token: string, apiUrl: string, webUrl: string): string {
  const bash = buildInstallCommand("mac", token, apiUrl, webUrl);
  const ps1 = buildInstallCommand("windows", token, apiUrl, webUrl);
  const startMac = buildStartCommand("mac");
  const startWindows = buildStartCommand("windows");

  if (target === "chatgpt") {
    return [
      "I'm setting up the VibeHub tracker. You can't run commands, so walk me through it one step at a time. Install first — starting is a separate step.",
      "",
      "1. Ask whether I'm on macOS/Linux or Windows.",
      "2. Give me only the matching command to run in my own terminal, then ask what it printed. It downloads the tracker and saves my token; it starts no background tracker and adds no OS autostart:",
      `   - macOS/Linux: ${bash}`,
      `   - Windows (PowerShell): ${ps1}`,
      "3. Read what I pasted. On a rejected token or any error, help me fix it from the actual output — never assume it worked.",
      `4. Stop and ask me whether to start the tracker. Say plainly: ${BACKGROUND_START_MEANS} Wait for my answer — a successful install is not permission to start.`,
      "5. Only if I say yes, give me the matching line to run myself; if I say no, stop — I can start it later:",
      `   - macOS/Linux: ${startMac}`,
      `   - Windows (PowerShell): ${startWindows}`,
      '6. Ask me to run the check and paste its output, then tell me plainly whether it says "Connected: yes":',
      `   - macOS/Linux: ${buildVerifyLine("mac")}`,
      `   - Windows (PowerShell): ${buildVerifyLine("windows")}`,
    ].join("\n");
  }

  return [
    "Set up the VibeHub tracker on this machine. Install only — do not start it.",
    "",
    "1. Detect the OS: macOS/Linux or Windows.",
    "2. Run the matching command. It downloads the tracker and saves my token; it starts no background tracker and adds no OS autostart:",
    `   - macOS/Linux: ${bash}`,
    `   - Windows (PowerShell): ${ps1}`,
    "3. Report what it printed. On a rejected token or any error, stop and show me the output — never assume it worked.",
    `4. Stop and ask me whether to start the tracker. Say plainly: ${BACKGROUND_START_MEANS} Wait for my answer — a successful install is not permission to start.`,
    "5. Only if I say yes, run the start command; if I say no, stop — I can start it later:",
    `   - macOS/Linux: ${startMac}`,
    `   - Windows (PowerShell): ${startWindows}`,
    "6. Verify and report the exact output:",
    `   - macOS/Linux: ${buildVerifyLine("mac")}`,
    `   - Windows (PowerShell): ${buildVerifyLine("windows")}`,
    "",
    BLOCKED_CLAUSE,
  ].join("\n");
}
