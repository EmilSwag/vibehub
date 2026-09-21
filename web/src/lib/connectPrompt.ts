// Commands and disclosures shared by the connect sheet and Settings Add device.
// One device connection covers supported sources, not separate provider accounts.
// Copy never executes anything. Assisted execution requires an explicit yes first.
// Pinned by lib/__checks__/connectPrompt.check.ts.

/** Legacy target names remain accepted; they no longer select tracking integrations. */
export type ConnectPromptTarget = "assistant" | "cursor" | "claude-code" | "codex" | "quadcode" | "chatgpt";
export type InstallOs = "mac" | "windows";
/** Login is deliberately absent: these controls never carry a device key. */
export type TrackerVerb = "start" | "status" | "stop";

export const DEVICE_CONNECT_SCOPE =
  "One connection for all supported tools on this device. No per-tool setup.";
export const NODE_SETUP_NOTICE = "Node.js is installed automatically if needed.";
export const INSTALL_START_MEANS = "Running this command installs VibeHub and starts background tracking.";
export const BACKGROUND_START_MEANS = "Runs in the background until you stop it. No OS autostart.";
export const TRACKER_LOCAL_READS =
  "Reads only Claude Code, Codex and Quadcode AI session logs. Parsing may temporarily read records containing prompts, code and tool output. These contents are not saved or sent.";
export const TRACKER_UPLOADS =
  "Sends only tool/model, timing, measured usage counts (tokens where the tool reports them) and a bounded project alias to VibeHub.";
export const TRACKER_VISIBILITY =
  "Profiles and statistics, including recent activity, are public. Live presence cards are shared with accepted friends.";
export const TRACKER_SUPPORT_NOTICE =
  "Tracks Claude Code, Codex (GPT models) and Quadcode AI. Quadcode AI counts activity and model only: it reports no tokens, so none are shown or estimated. Cursor, Windsurf and ChatGPT/browser tracking are unavailable.";
export const TRACKER_SUPPORT_DETAILS =
  "No monitoring of other apps, processes, windows, browsing, keyboard activity, computer idle or Git. Unknown models stay unknown. Unsupported activity is not estimated. Setup does not install AI apps or connect provider accounts.";
export const TRACKER_STATE_NOTICE =
  "Connected means a recent server-accepted tracker connection. Idle means no recent supported AI activity—not an idle computer.";
export const TRACKER_HISTORY_NOTICE =
  "AI-only tracking applies going forward. Earlier public tracker history has not been erased or revalidated.";
export const TRACKER_CONTROL_NOTICE =
  "Run Stop on the device to stop local tracking. Revoke blocks future reporting with that key, but does not guarantee local shutdown. Neither action erases history.";
export const PRIVATE_COMMAND_NOTICE =
  "Private command: contains your device key. Do not share it publicly. Your terminal or AI assistant may retain it.";
export const COPY_ONLY_NOTICE = "Copying does not run anything. Paste into your own terminal when you choose to start.";
export const CONNECT_COMMAND_ERROR = "Could not prepare a connection command. Reopen setup or contact support.";

// Canonical paths agreed with the connector owner. Prefer the private runtime if
// present, so an older global Node cannot shadow the runtime the connector prepared.
// Otherwise use the compatible global Node that the connector reused. Quoted $HOME
// paths also work for legacy installations and home directories containing spaces.
const BIN = '"$HOME/.vibehub/app/vibehub-tracker.cjs"';
const NODE_POSIX = '"$HOME/.vibehub/runtime/bin/node"';
const NODE_WINDOWS = '"$HOME/.vibehub/runtime/node.exe"';
const NODE_PROBE = 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)';

function checkOs(os: InstallOs): void {
  if (os !== "mac" && os !== "windows") throw new Error(CONNECT_COMMAND_ERROR);
}

export function buildTrackerCommand(os: InstallOs, verb: TrackerVerb): string {
  checkOs(os);
  if (verb !== "start" && verb !== "status" && verb !== "stop") throw new Error(CONNECT_COMMAND_ERROR);
  // The connector can reuse global Node when an old/broken private binary remains.
  // Existence alone must not select that unusable binary for later controls.
  return os === "windows"
    ? `& { $vhNode = ${NODE_WINDOWS}; $ok = $false; if (Test-Path -LiteralPath $vhNode -PathType Leaf) { try { & $vhNode -e '${NODE_PROBE}' 2>$null; $ok = $LASTEXITCODE -eq 0 } catch {} }; if (-not $ok) { $vhNode = 'node' }; & $vhNode ${BIN} ${verb} }`
    : `if [ -x ${NODE_POSIX} ] && ${NODE_POSIX} -e '${NODE_PROBE}' >/dev/null 2>&1; then ${NODE_POSIX} ${BIN} ${verb}; else node ${BIN} ${verb}; fi`;
}

export const buildStartCommand = (os: InstallOs): string => buildTrackerCommand(os, "start");
export const buildStatusCommand = (os: InstallOs): string => buildTrackerCommand(os, "status");
export const buildStopCommand = (os: InstallOs): string => buildTrackerCommand(os, "stop");

// Reject ambiguous/untrusted inputs rather than interpolating them into a shell or
// leaking their value through an error message. Keys are opaque printable identifiers;
// control characters, whitespace and shell syntax are never valid key input here.
function checkToken(token: string): void {
  // A JavaScript `$` anchor also matches before a final newline. Reject every
  // non-key character explicitly so a pasted line ending cannot pass validation.
  if (typeof token !== "string" || token.length < 1 || token.length > 512 || /[^A-Za-z0-9._~-]/.test(token)) {
    throw new Error(CONNECT_COMMAND_ERROR);
  }
}

/** Deployment origins only. HTTP is restricted to explicit loopback previews.
 *  Exported so the Mac install line (`lib/macInstall.ts`) validates origins with these
 *  exact rules rather than a second, drifting copy of them. */
export function assertOrigin(value: string): string {
  try {
    if (!/^https?:\/\//i.test(value) || value.length > 2048 || /[\x00-\x20\x7f-\x9f\s\\'"`$;&|<>?#]/.test(value)) throw new Error();
    const url = new URL(value);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new Error();
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error();
    return url.origin;
  } catch {
    throw new Error(CONNECT_COMMAND_ERROR);
  }
}

const quoteSh = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;
const quotePs = (value: string): string => `'${value.replace(/'/g, "''")}'`;

function scriptCommand(
  os: InstallOs,
  token: string,
  apiUrl: string,
  webUrl: string,
  script: "install" | "connect",
  start: boolean,
): string {
  checkOs(os);
  checkToken(token);
  const api = assertOrigin(apiUrl);
  const web = assertOrigin(webUrl);
  if (os === "windows") {
    // Scope preferences to this invocation, restore deployment settings, and erase
    // the copied key even if the initial script download fails before it can clean up.
    return `& { $ErrorActionPreference = 'Stop'; $oldApi = $env:VIBEHUB_API_URL; $oldWeb = $env:VIBEHUB_WEB_URL; try { $env:VIBEHUB_TOKEN=${quotePs(token)}; $env:VIBEHUB_API_URL=${quotePs(api)}; $env:VIBEHUB_WEB_URL=${quotePs(web)}; & ([scriptblock]::Create((irm ${quotePs(`${web}/tracker/${script}.ps1`)} -TimeoutSec 60 -MaximumRedirection 0)))${start ? " -Start" : ""} } finally { Remove-Item Env:VIBEHUB_TOKEN -ErrorAction SilentlyContinue; $env:VIBEHUB_API_URL = $oldApi; $env:VIBEHUB_WEB_URL = $oldWeb } }`;
  }
  // Do not let an empty/failed download look successful merely because Bash read
  // an empty stream. Ignore local curl config and refuse redirects/protocol changes.
  // HTTP is only possible for the literal loopback origins accepted above.
  const protocols = web.startsWith("http:") ? "=http,https" : "=https";
  return `(set -o pipefail; curl -q --fail --silent --show-error --location --max-redirs 0 --proto ${quoteSh(protocols)} --connect-timeout 20 --max-time 60 ${quoteSh(`${web}/tracker/${script}.sh`)} | VIBEHUB_TOKEN=${quoteSh(token)} VIBEHUB_API_URL=${quoteSh(api)} VIBEHUB_WEB_URL=${quoteSh(web)} bash -s --${start ? " --start" : ""})`;
}

/** Primary manual path. Running it explicitly consents to both install and start. */
export function buildOneCommandConnect(os: InstallOs, token: string, apiUrl: string, webUrl: string): string {
  return scriptCommand(os, token, apiUrl, webUrl, "connect", true);
}

/** Legacy setup-only path: no start flag, no runtime bootstrap promise. */
export function buildInstallCommand(os: InstallOs, token: string, apiUrl: string, webUrl: string): string {
  return scriptCommand(os, token, apiUrl, webUrl, "install", false);
}

/** Status output is diagnostic; token verification alone is not a received heartbeat. */
export function buildVerifyLine(os: InstallOs): string {
  return `Run ${buildStatusCommand(os)}; report exact output. Require a fresh server-accepted tracker connection, not "Connected: yes" alone.`;
}

const BLOCKED_CLAUSE =
  "If your safety rules or approval prompts block installation or background start, stop automating: say so and show me the matching command for my own terminal. Do not retry with other flags, shells or wrapper scripts, and do not edit any permission, allow-list or settings file. A blocked step is a normal outcome, not a problem to solve.";

/** Generic assisted setup; the optional OS keeps the visible prompt to one command.
 * Old callers without an OS still receive both branches, never a provider selector. */
export function buildConnectPrompt(
  target: ConnectPromptTarget,
  token: string,
  apiUrl: string,
  webUrl: string,
  os?: InstallOs,
): string {
  if (os !== undefined) checkOs(os);
  const oses: InstallOs[] = os ? [os] : ["mac", "windows"];
  const label = (value: InstallOs) => value === "windows" ? "Windows (PowerShell)" : "macOS/Linux (bash)";
  const guided = target === "chatgpt";
  return [
    "Connect VibeHub. Do not run commands yet.",
    DEVICE_CONNECT_SCOPE,
    guided
      ? "You can't run commands. Guide me without claiming to have installed or started anything."
      : "If you cannot run commands, guide me. ChatGPT cannot run them.",
    "Explain:",
    INSTALL_START_MEANS,
    `${NODE_SETUP_NOTICE} A needed runtime is private to VibeHub; do not change the system PATH or install AI products.`,
    BACKGROUND_START_MEANS,
    TRACKER_LOCAL_READS,
    TRACKER_UPLOADS,
    TRACKER_VISIBILITY,
    TRACKER_SUPPORT_NOTICE,
    TRACKER_SUPPORT_DETAILS,
    TRACKER_STATE_NOTICE,
    TRACKER_CONTROL_NOTICE,
    PRIVATE_COMMAND_NOTICE,
    "",
    os ? `1. Confirm this device uses ${label(os)}.` : "1. Ask the OS: Windows/PowerShell or macOS/Linux/bash.",
    '2. Ask: "May I install VibeHub and start background tracking?" Wait for an explicit yes. Copying this prompt or a successful install is not permission to start. If I say no, stop.',
    guided
      ? "3. Only after my yes, give me the matching command to run myself:"
      : "3. Only after my yes, run the matching command or show it for manual use:",
    ...oses.map((value) => `   - ${label(value)}: ${buildOneCommandConnect(value, token, apiUrl, webUrl)}`),
    "4. On any download, integrity, token or start error, stop and report it without the device key. Never assume success or mistake a spawned process for a connection.",
    ...oses.map((value) => `   - ${label(value)}: ${buildVerifyLine(value)}`),
    "",
    BLOCKED_CLAUSE,
  ].join("\n");
}
