// Commands and disclosures shared by the connect sheet and Settings Add device.
// One device connection covers supported sources, not separate provider accounts.
// Copy never executes anything. Assisted execution requires an explicit yes first.
// Pinned by lib/__checks__/connectPrompt.check.ts.
//
// Every sentence that names a tool builds its list from `supportedTools.ts`. Adding a
// tool to that table changes this copy; nothing here spells the set out by hand.

import { HOOK_TOOLS, LOG_TOOLS, MEASURED_TOOLS, TOKENLESS_TOOLS, isHookToolId, namesOf, qualifiedNamesOf, untrackedClause } from "./supportedTools";
import type { HookToolId } from "./supportedTools";

/** Legacy target names remain accepted; they no longer select tracking integrations. */
export type ConnectPromptTarget = "assistant" | "cursor" | "claude-code" | "codex" | "quadcode" | "chatgpt";
export type InstallOs = "mac" | "windows";
/** Login is deliberately absent: these controls never carry a device key. */
export type TrackerVerb = "start" | "status" | "stop";

export const DEVICE_CONNECT_SCOPE =
  `One connection for all supported tools on this device. ${namesOf(HOOK_TOOLS)} each add a one-time opt-in.`;
export const NODE_SETUP_NOTICE = "Node.js is installed automatically if needed.";
export const INSTALL_START_MEANS = "Running this command installs VibeHub and starts background tracking.";
export const BACKGROUND_START_MEANS = "Runs in the background until you stop it. No OS autostart.";
export const TRACKER_LOCAL_READS =
  `Reads only ${namesOf(LOG_TOOLS)} session logs. Parsing may temporarily read records containing prompts, code and tool output. These contents are not saved or sent. ${namesOf(HOOK_TOOLS)} send their own turn events through a hook you install; their logs, files and windows are never read.`;
export const TRACKER_UPLOADS =
  "Sends only tool/model, timing, measured usage counts (tokens where the tool reports them) and a bounded project alias to VibeHub.";
export const TRACKER_VISIBILITY =
  "Profiles and statistics, including recent activity, are public. Live presence cards are shared with accepted friends.";
// Four facts, one per sentence, every tool name from the table:
//   what is measured; what is activity-only; what the hook tools do and the one
//   limit on their model; and what is not tracked at all, with the reason.
// The hook model clause matters because a vendor display id that is not in the
// reviewed allowlist normalises to null (hooks report 1, "Model"), so the honest
// promise is "recognised ids only", not "the model".
export const TRACKER_SUPPORT_NOTICE =
  `Tracks ${qualifiedNamesOf(MEASURED_TOOLS)} with measured tokens. ${namesOf(TOKENLESS_TOOLS)} count activity and model only: they report no tokens, so none are shown or estimated. ${namesOf(HOOK_TOOLS)} report through a hook you install on each device, and show a model only when VibeHub recognises the id. ${untrackedClause()}`;
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

/**
 * One key-free invocation of the installed connector, with its arguments already
 * fixed by the caller. Every control below is this line with a different tail, so
 * the private-runtime-then-global-Node resolution can never drift between them.
 * `tail` is only ever built from validated literals — never from user input.
 */
function cliCommand(os: InstallOs, tail: string): string {
  checkOs(os);
  // The connector can reuse global Node when an old/broken private binary remains.
  // Existence alone must not select that unusable binary for later controls.
  return os === "windows"
    ? `& { $vhNode = ${NODE_WINDOWS}; $ok = $false; if (Test-Path -LiteralPath $vhNode -PathType Leaf) { try { & $vhNode -e '${NODE_PROBE}' 2>$null; $ok = $LASTEXITCODE -eq 0 } catch {} }; if (-not $ok) { $vhNode = 'node' }; & $vhNode ${BIN} ${tail} }`
    : `if [ -x ${NODE_POSIX} ] && ${NODE_POSIX} -e '${NODE_PROBE}' >/dev/null 2>&1; then ${NODE_POSIX} ${BIN} ${tail}; else node ${BIN} ${tail}; fi`;
}

export function buildTrackerCommand(os: InstallOs, verb: TrackerVerb): string {
  checkOs(os);
  if (verb !== "start" && verb !== "status" && verb !== "stop") throw new Error(CONNECT_COMMAND_ERROR);
  return cliCommand(os, verb);
}

export const buildStartCommand = (os: InstallOs): string => buildTrackerCommand(os, "start");
export const buildStatusCommand = (os: InstallOs): string => buildTrackerCommand(os, "status");
export const buildStopCommand = (os: InstallOs): string => buildTrackerCommand(os, "stop");

// ---------------------------------------------------------------------------
// Cursor / Windsurf hook opt-in (docs/ARCHITECTURE.md §4.7)
// ---------------------------------------------------------------------------

/** `hooks status` reports every tool at once and therefore takes none. */
export type HookVerb = "install" | "uninstall" | "status";

/** The literal CLI invocation, byte for byte what the docs and the vendor report
 *  spell: `vibehub-tracker hooks install cursor`. */
const HOOKS_CLI = "vibehub-tracker hooks";

/**
 * `vibehub-tracker hooks <verb> [tool]`, in the same key-free family as
 * start/status/stop — it carries no device key, writes only a user-scope vendor file
 * and is safe to share.
 *
 * DELIBERATELY NOT wrapped in `cliCommand`'s private-runtime resolution. The three
 * tracker controls are wrapped because they are recovery commands: they have to work
 * on a machine whose global Node is too old or whose connector is half-broken. This
 * one is the opposite situation — the reader has a working connector on PATH and is
 * adding a tool to it — and a wrapper here would mean the line on screen is not the
 * line anyone can quote, document or read back in a support thread. What is shown and
 * what is copied are this exact string, and no other.
 *
 * Same OS on both platforms: the command has no shell syntax to differ over, which is
 * why it takes no `InstallOs`.
 *
 * The tool id is validated against the table, never interpolated from free input.
 */
export function buildHooksCommand(verb: HookVerb, tool?: HookToolId, dryRun = false): string {
  if (verb !== "install" && verb !== "uninstall" && verb !== "status") throw new Error(CONNECT_COMMAND_ERROR);
  const perTool = verb !== "status";
  if (perTool ? !isHookToolId(tool) : tool !== undefined) throw new Error(CONNECT_COMMAND_ERROR);
  if (dryRun && verb !== "install") throw new Error(CONNECT_COMMAND_ERROR);
  return `${HOOKS_CLI} ${verb}${perTool ? ` ${tool as string}` : ""}${dryRun ? " --dry-run" : ""}`;
}

export const HOOKS_TITLE = `${namesOf(HOOK_TOOLS)} (optional)`;
export const HOOKS_SCOPE =
  `${namesOf(HOOK_TOOLS)} have no session log to read. Install a hook in each one, on each device, and it reports its own turns.`;
export const HOOKS_REPORTS =
  "Each turn reports the tool, the model and when it ran. No tokens, no cost estimate, and usually no project.";
export const HOOKS_WRITES =
  `Writes one file in your home folder: ${HOOK_TOOLS.map((tool) => tool.hookFile).join(" or ")}. Shared project and system-wide hook files are never touched.`;
export const HOOKS_DRY_RUN = "Preview shows the exact change and writes nothing.";
export const HOOKS_REVERSIBLE =
  "Uninstall removes the hook file entry and withdraws consent. Later turns then report nothing.";
/**
 * TWO things are missing today, and the copy names both rather than the easier one.
 *
 *   1. Nothing puts `vibehub-tracker` on PATH. The connector installs the CLI at
 *      `~/.vibehub/app/vibehub-tracker.cjs` and calls it through node; neither
 *      `connect.sh` nor `connect.ps1` writes a shim, symlink or .cmd. -> command not found.
 *   2. The served bundle predates `hook`/`hooks` (hooks report F4). -> unknown command.
 *
 * Both are release-ordering work for the tracker/installer lane, so this sentence
 * promises no fix and offers no workaround: it must not read as "you are nearly there",
 * and it must not imply that installing the connector in the normal way makes these
 * lines runnable. It says what a reader will actually see if they try one today.
 */
export const HOOKS_CLI_REQUIREMENT =
  "These commands run vibehub-tracker from your PATH. Installing the connector does not put it there, and a connector built before hook support has no hooks command — so today they answer command not found, or an unknown-command error.";

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
