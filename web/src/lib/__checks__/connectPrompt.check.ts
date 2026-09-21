// Synthetic contract pins. Run: node web/scripts/run-checks.mjs connectPrompt
// No shell command, tracker, network request, or real key is used by this file.
// Preserve the old consent/refusal, token, both-OS and path checks, adapted to the
// new explicit-yes-before-combined-command contract. Legacy setup stays start-free.
import {
  BACKGROUND_START_MEANS,
  CONNECT_COMMAND_ERROR,
  COPY_ONLY_NOTICE,
  DEVICE_CONNECT_SCOPE,
  INSTALL_START_MEANS,
  NODE_SETUP_NOTICE,
  PRIVATE_COMMAND_NOTICE,
  TRACKER_CONTROL_NOTICE,
  TRACKER_HISTORY_NOTICE,
  TRACKER_LOCAL_READS,
  TRACKER_STATE_NOTICE,
  TRACKER_SUPPORT_DETAILS,
  TRACKER_SUPPORT_NOTICE,
  TRACKER_UPLOADS,
  TRACKER_VISIBILITY,
  buildConnectPrompt,
  buildInstallCommand,
  buildOneCommandConnect,
  buildStartCommand,
  buildStatusCommand,
  buildStopCommand,
  buildHooksCommand,
  buildTrackerCommand,
  buildVerifyLine,
} from "../connectPrompt";
import type { ConnectPromptTarget, HookVerb, InstallOs, TrackerVerb } from "../connectPrompt";
import { HOOK_TOOL_IDS } from "../supportedTools";
import type { HookToolId } from "../supportedTools";

let passed = 0;
const failures: string[] = [];
function eq<T>(label: string, actual: T, expected: T): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed += 1;
    console.log(`ok   ${label}`);
  } else {
    failures.push(label);
    console.log(`FAIL ${label}\n     expected ${JSON.stringify(expected)}\n     actual   ${JSON.stringify(actual)}`);
  }
}
function rejected(run: () => unknown): boolean {
  try { run(); return false; }
  catch (error) { return error instanceof Error && error.message === CONNECT_COMMAND_ERROR; }
}
const TOKEN = "fixture-device-key-0123456789";
const API = "https://api.example.test";
const WEB = "https://web.example.test";
const OSES: InstallOs[] = ["mac", "windows"];
const VERBS: TrackerVerb[] = ["start", "status", "stop"];
const AGENTIC: ConnectPromptTarget[] = ["assistant", "cursor", "claude-code", "codex", "quadcode"];
const ALL: ConnectPromptTarget[] = [...AGENTIC, "chatgpt"];
const promptFor = (target: ConnectPromptTarget, os?: InstallOs) => buildConnectPrompt(target, TOKEN, API, WEB, os);

// Exact shared connector contract: one line, environment values quoted, explicit start.
eq("POSIX has a bounded HTTPS fetch, pipeline failure propagation and explicit --start", buildOneCommandConnect("mac", TOKEN, API, WEB),
  `(set -o pipefail; curl -q --fail --silent --show-error --location --max-redirs 0 --proto '=https' --connect-timeout 20 --max-time 60 '${WEB}/tracker/connect.sh' | VIBEHUB_TOKEN='${TOKEN}' VIBEHUB_API_URL='${API}' VIBEHUB_WEB_URL='${WEB}' bash -s -- --start)`);
eq("Windows scopes environment, refuses redirects and clears the key even on initial-download failure", buildOneCommandConnect("windows", TOKEN, API, WEB),
  `& { $ErrorActionPreference = 'Stop'; $oldApi = $env:VIBEHUB_API_URL; $oldWeb = $env:VIBEHUB_WEB_URL; try { $env:VIBEHUB_TOKEN='${TOKEN}'; $env:VIBEHUB_API_URL='${API}'; $env:VIBEHUB_WEB_URL='${WEB}'; & ([scriptblock]::Create((irm '${WEB}/tracker/connect.ps1' -TimeoutSec 60 -MaximumRedirection 0))) -Start } finally { Remove-Item Env:VIBEHUB_TOKEN -ErrorAction SilentlyContinue; $env:VIBEHUB_API_URL = $oldApi; $env:VIBEHUB_WEB_URL = $oldWeb } }`);
for (const build of [buildOneCommandConnect, buildInstallCommand]) {
  const ps = build("windows", TOKEN, API, WEB);
  const sh = build("mac", TOKEN, API, WEB);
  eq("both Windows paths clear the key in finally", ps.includes("finally { Remove-Item Env:VIBEHUB_TOKEN"), true);
  eq("both Windows paths restore previous deployment environment", ps.includes("$env:VIBEHUB_API_URL = $oldApi; $env:VIBEHUB_WEB_URL = $oldWeb"), true);
  eq("both Windows paths stop initial fetch failures and redirects", ps.includes("$ErrorActionPreference = 'Stop'") && ps.includes("-MaximumRedirection 0"), true);
  eq("both POSIX paths use subshell pipefail without changing the parent shell", sh.startsWith("(set -o pipefail;") && sh.endsWith(")"), true);
  eq("both POSIX paths ignore curl configuration and disallow redirects", sh.includes("curl -q ") && sh.includes("--max-redirs 0"), true);
  eq("remote command cannot downgrade HTTPS", sh.includes("--proto '=https'"), true);
  eq("HTTP protocol exception stays confined to validated loopback", build("mac", TOKEN, "http://127.0.0.1:4000", "http://localhost:5173").includes("--proto '=http,https'"), true);
}
for (const os of OSES) {
  const command = buildOneCommandConnect(os, TOKEN, API, WEB);
  const install = buildInstallCommand(os, TOKEN, API, WEB);
  eq(`${os}: one copyable line`, /[\r\n]/.test(command), false);
  eq(`${os}: the primary command carries the key exactly once`, command.split(TOKEN).length - 1, 1);
  eq(`${os}: setup-only helper still carries its key`, install.includes(TOKEN), true);
  eq(`${os}: legacy setup uses the legacy installer`, install.includes(`/tracker/install.${os === "mac" ? "sh" : "ps1"}`), true);
  eq(`${os}: legacy setup starts nothing`, /(?:--start|-Start|\btracker\.cjs["']? start\b)/.test(install), false);
  eq(`${os}: origins are normalized, not double-slashed`, buildOneCommandConnect(os, TOKEN, `${API}/`, `${WEB}/`), command);
  eq(`${os}: default HTTPS port normalizes safely`, buildOneCommandConnect(os, TOKEN, `${API}:443`, `${WEB}:443`), command);
  eq(`${os}: loopback preview origins are supported`, buildOneCommandConnect(os, TOKEN, "http://127.0.0.1:4000", "http://localhost:5173").includes("'http://localhost:5173/tracker/connect."), true);
  eq(`${os}: IPv6 loopback is quoted`, buildOneCommandConnect(os, TOKEN, "http://[::1]:4000", "http://[::1]:5173").includes("'http://[::1]:5173'"), true);
  eq(`${os}: opaque safe key punctuation remains literal`, buildOneCommandConnect(os, "fixture._~-key", API, WEB).includes("'fixture._~-key'"), true);
}

// Private Node is resolved for all three controls. Neither home path is bare or ~.
for (const verb of VERBS) {
  eq(`POSIX ${verb}: private runtime then legacy global fallback, both paths quoted`, buildTrackerCommand("mac", verb),
    `if [ -x "$HOME/.vibehub/runtime/bin/node" ] && "$HOME/.vibehub/runtime/bin/node" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' >/dev/null 2>&1; then "$HOME/.vibehub/runtime/bin/node" "$HOME/.vibehub/app/vibehub-tracker.cjs" ${verb}; else node "$HOME/.vibehub/app/vibehub-tracker.cjs" ${verb}; fi`);
  eq(`Windows ${verb}: literal private executable path and invocation operator`, buildTrackerCommand("windows", verb),
    `& { $vhNode = "$HOME/.vibehub/runtime/node.exe"; $ok = $false; if (Test-Path -LiteralPath $vhNode -PathType Leaf) { try { & $vhNode -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' 2>$null; $ok = $LASTEXITCODE -eq 0 } catch {} }; if (-not $ok) { $vhNode = 'node' }; & $vhNode "$HOME/.vibehub/app/vibehub-tracker.cjs" ${verb} }`);
  for (const os of OSES) {
    const command = buildTrackerCommand(os, verb);
    eq(`${os} ${verb}: no key or login in a follow-up control`, command.includes(TOKEN) || /\blogin\b/.test(command), false);
    eq(`${os} ${verb}: no bare tilde`, command.includes("~"), false);
    eq(`${os} ${verb}: shell expands a quoted HOME path (spaces and metacharacters stay one argument)`, command.includes('"$HOME/.vibehub/app/vibehub-tracker.cjs"'), true);
  }
}
for (const os of OSES) {
  eq(`${os}: start wrapper stays aligned`, buildStartCommand(os), buildTrackerCommand(os, "start"));
  eq(`${os}: status wrapper stays aligned`, buildStatusCommand(os), buildTrackerCommand(os, "status"));
  eq(`${os}: stop wrapper stays aligned`, buildStopCommand(os), buildTrackerCommand(os, "stop"));
  eq(`${os}: verification includes the OS-correct status command`, buildVerifyLine(os).includes(buildStatusCommand(os)), true);
  eq(`${os}: verification carries no key`, buildVerifyLine(os).includes(TOKEN), false);
  eq(`${os}: login/verify is explicitly insufficient for success`, buildVerifyLine(os).includes('not "Connected: yes" alone'), true);
}

// Reject injection-like inputs before rendering a command, with no input in errors.
const BAD_TOKENS = ["", " key", "key with space", "a'b", 'a"b', "$(id)", "`id`", "a;b", "a|b", "a&b", "a\nb", "a\rb", "a\tb", "a\u0000b", "key\n", "key\r", "key\r\n", "key\u2028", "key\u2029", "x".repeat(513), null as unknown as string];
const BAD_ORIGINS = [
  "", "https:example.test", "//example.test", "http://example.test", "file:///tmp/a", "javascript:alert(1)",
  "https://user:password@example.test", "https://example.test/api", "https://example.test?x=1", "https://example.test#fragment",
  "https://example.test'; id #", 'https://example.test/";Write-Output bad', "https://example.test/$(id)",
  "https://example.test/`id`", "https://example.test\\evil", "https://exam\nple.test", "https://exam\tple.test", "https://exam\u0000ple.test",
];
for (const os of OSES) {
  eq(`${os}: unsafe keys predictably reject in both builders`, BAD_TOKENS.every((token) =>
    rejected(() => buildOneCommandConnect(os, token, API, WEB)) && rejected(() => buildInstallCommand(os, token, API, WEB))), true);
  eq(`${os}: unsafe API origins predictably reject in both builders`, BAD_ORIGINS.every((url) =>
    rejected(() => buildOneCommandConnect(os, TOKEN, url, WEB)) && rejected(() => buildInstallCommand(os, TOKEN, url, WEB))), true);
  eq(`${os}: unsafe web origins predictably reject in both builders`, BAD_ORIGINS.every((url) =>
    rejected(() => buildOneCommandConnect(os, TOKEN, API, url)) && rejected(() => buildInstallCommand(os, TOKEN, API, url))), true);
}
eq("invalid OS cannot select an implicit shell", rejected(() => buildOneCommandConnect("other" as InstallOs, TOKEN, API, WEB)), true);
eq("invalid tracker verb cannot inject a command", rejected(() => buildTrackerCommand("mac", "start; id" as TrackerVerb)), true);
eq("invalid tracker OS predictably rejects", rejected(() => buildTrackerCommand("other" as InstallOs, "status")), true);
eq("empty optional assistant OS is not treated as a default", rejected(() => promptFor("assistant", "" as InstallOs)), true);
eq("assistant prompt validates its key too", rejected(() => buildConnectPrompt("assistant", "a'b", API, WEB, "windows")), true);

// Consent/refusal pins retained for every old target plus the new generic assistant.
const ASK = 'Ask: "May I install VibeHub and start background tracking?"';
const DISCLOSURES = [DEVICE_CONNECT_SCOPE, INSTALL_START_MEANS, NODE_SETUP_NOTICE, BACKGROUND_START_MEANS,
  TRACKER_LOCAL_READS, TRACKER_UPLOADS, TRACKER_VISIBILITY, TRACKER_SUPPORT_NOTICE,
  TRACKER_SUPPORT_DETAILS, TRACKER_STATE_NOTICE, TRACKER_CONTROL_NOTICE, PRIVATE_COMMAND_NOTICE];
const BYPASS = ["--dangerously-skip-permissions", "--dangerously", "--no-verify", "bypass", "allowlist", "allow-list it", "whitelist", "sudo", "chmod +x", "disable the safety", "settings.local.json", "ignore the warning", "approve it automatically", "auto-approve"];
const UNSAFE_PROMISE = /reads no file contents|only metadata(?: is)? (?:read|collected)|nothing unrelated (?:is )?collected|never reads? (?:your )?prompts|prompts (?:are )?never read|never (?:your )?code(?:,| or) prompts|stats (?:are )?private|all AI (?:apps|models) (?:work|are tracked)/i;
const LEGACY_COLLECTION_CLAIM = /reads (?:local )?process(?: and window|\/window)|including unrelated apps|log readers cover[^.]*Quadcode|other app detections can use process\/window/i;
for (const target of ALL) {
  const compatibility = promptFor(target);
  eq(`${target}: old callers still receive both OS commands`, OSES.every((os) => compatibility.includes(buildOneCommandConnect(os, TOKEN, API, WEB))), true);
  eq(`${target}: old callers still receive both diagnostic lines`, OSES.every((os) => compatibility.includes(buildVerifyLine(os))), true);
  eq(`${target}: compatibility prompt contains the key only in its two commands`, compatibility.split(TOKEN).length - 1, 2);
  for (const os of OSES) {
    const text = promptFor(target, os);
    const command = buildOneCommandConnect(os, TOKEN, API, WEB);
    const otherOs = os === "mac" ? "windows" : "mac";
    const ask = text.indexOf(ASK);
    eq(`${target}/${os}: exactly one key-bearing command`, text.split(TOKEN).length - 1, 1);
    eq(`${target}/${os}: OS-matched command present`, text.includes(command), true);
    eq(`${target}/${os}: no competing OS command`, text.includes(buildOneCommandConnect(otherOs, TOKEN, API, WEB)), false);
    eq(`${target}/${os}: all load-bearing disclosures precede the question`, ask >= 0 && DISCLOSURES.every((value) => text.indexOf(value) >= 0 && text.indexOf(value) < ask), true);
    eq(`${target}/${os}: ask, wait for an explicit yes, then command`, ask < text.indexOf("Wait for an explicit yes.") && text.indexOf("Wait for an explicit yes.") < text.indexOf(command), true);
    eq(`${target}/${os}: copying/installing is not approval`, text.includes("Copying this prompt or a successful install is not permission to start."), true);
    eq(`${target}/${os}: a no ends automation`, text.includes("If I say no, stop."), true);
    eq(`${target}/${os}: installation and background start can both be blocked`, text.includes("block installation or background start, stop automating"), true);
    eq(`${target}/${os}: a blocked operation offers the matching manual command`, text.includes("show me the matching command for my own terminal"), true);
    eq(`${target}/${os}: no retry around refusal`, text.includes("Do not retry with other flags, shells or wrapper scripts"), true);
    eq(`${target}/${os}: permission/settings edits are forbidden`, text.includes("do not edit any permission, allow-list or settings file"), true);
    eq(`${target}/${os}: refusal is an acceptable outcome`, text.includes("A blocked step is a normal outcome, not a problem to solve."), true);
    eq(`${target}/${os}: OS-correct private-runtime verification is retained`, text.includes(buildVerifyLine(os)), true);
    eq(`${target}/${os}: start errors do not become claimed success`, text.includes("On any download, integrity, token or start error, stop") && text.includes("mistake a spawned process for a connection"), true);
    eq(`${target}/${os}: unsupported AI tools/models are not promised`, text.includes(TRACKER_SUPPORT_NOTICE) && text.includes("Unknown models stay unknown."), true);
    eq(`${target}/${os}: no AI-product installs or system PATH changes`, text.includes("do not change the system PATH or install AI products"), true);
    eq(`${target}/${os}: no unsafe vocabulary`, BYPASS.filter((value) => text.toLowerCase().includes(value)), []);
    eq(`${target}/${os}: no audited false privacy guarantees`, UNSAFE_PROMISE.test(text), false);
  }
}
for (const target of AGENTIC) {
  eq(`${target}: provider choice does not change setup or tracking`, promptFor(target, "mac"), promptFor("assistant", "mac"));
}
eq("ChatGPT cannot execute commands", promptFor("chatgpt").includes("You can't run commands. Guide me without claiming to have installed or started anything."), true);
eq("ChatGPT asks before offering the command for manual use", promptFor("chatgpt").indexOf(ASK) < promptFor("chatgpt").indexOf("Only after my yes, give me the matching command to run myself"), true);

// The previous 1700-char ratchet omitted critical current local-reading/audience
// facts and assumed bare Node controls. Raise only to fit that load-bearing content.
// Round 4 (Quadcode support): the support line now names three tools and says
// Quadcode's tokens are absent rather than estimated — +170 chars of truth, no filler.
// Cursor/Windsurf rollout: the support line now separates the two measuring tools
// from the three tokenless ones, says the two hook tools need their own opt-in, and
// the local-reads line states that their logs and windows are still never read.
// Then two more load-bearing qualifications: a hook tool shows a model only for an id
// this project already recognises (an unreviewed vendor id normalises to null, so
// promising "the model" would over-claim), and ChatGPT is refused with its reason
// rather than a bare "unavailable". +84 chars; measured body is 3851.
const PROMPT_BODY_MAX = 3900;
eq("generic prose stays bounded without deleting consent (both-OS compatibility)", AGENTIC.map((target) => {
  let body = promptFor(target);
  for (const os of OSES) body = body.replace(buildOneCommandConnect(os, TOKEN, API, WEB), "");
  return { target, chars: body.length };
}).filter(({ chars }) => chars >= PROMPT_BODY_MAX), []);
eq("foreground scope is one connection for supported tools, not providers", DEVICE_CONNECT_SCOPE,
  "One connection for all supported tools on this device. Cursor and Windsurf each add a one-time opt-in.");
eq("the one-connection promise no longer over-claims: hook tools are named as extra setup",
  HOOK_TOOL_IDS.every((tool) => DEVICE_CONNECT_SCOPE.toLowerCase().includes(tool)) && /one-time opt-in/.test(DEVICE_CONNECT_SCOPE), true);
eq("Node preparation is explicit", NODE_SETUP_NOTICE, "Node.js is installed automatically if needed.");
eq("running, not copying, installs and starts", INSTALL_START_MEANS.includes("Running this command") && INSTALL_START_MEANS.includes("starts background tracking"), true);
eq("background lifetime and no OS autostart remain explicit", BACKGROUND_START_MEANS, "Runs in the background until you stop it. No OS autostart.");
eq("local activity reads are Claude Code, Codex and Quadcode AI session logs only", TRACKER_LOCAL_READS.startsWith("Reads only Claude Code, Codex and Quadcode AI session logs."), true);
eq("hook tools are disclosed as a push, and their own files are still never read",
  TRACKER_LOCAL_READS.includes("Cursor and Windsurf send their own turn events through a hook you install; their logs, files and windows are never read."), true);
eq("temporary mixed-record parsing is disclosed, not called metadata-only", TRACKER_LOCAL_READS.includes("Parsing may temporarily read records containing prompts, code and tool output."), true);
eq("record contents are neither saved nor sent", TRACKER_LOCAL_READS.includes("These contents are not saved or sent."), true);
eq("uploads name bounded metadata and measured usage, not project paths", TRACKER_UPLOADS, "Sends only tool/model, timing, measured usage counts (tokens where the tool reports them) and a bounded project alias to VibeHub.");
eq("public statistics and friend-only live cards are explicit", TRACKER_VISIBILITY.includes("statistics, including recent activity, are public") && TRACKER_VISIBILITY.includes("Live presence cards are shared with accepted friends"), true);
eq("support separates measured from tokenless, qualifies the hook tools' models, and refuses ChatGPT with a reason", TRACKER_SUPPORT_NOTICE,
  "Tracks Claude Code and Codex (GPT models) with measured tokens. Quadcode AI, Cursor and Windsurf count activity and model only: they report no tokens, so none are shown or estimated. Cursor and Windsurf report through a hook you install on each device, and show a model only when VibeHub recognises the id. ChatGPT is not tracked: browser and app leave no local source to read.");
eq("no supported tool is promised tokens it does not report", /Quadcode AI, Cursor and Windsurf count activity and model only: they report no tokens, so none are shown or estimated./.test(TRACKER_SUPPORT_NOTICE), true);
eq("a hook tool's model is promised only for an id this project already recognises",
  TRACKER_SUPPORT_NOTICE.includes("show a model only when VibeHub recognises the id"), true);
eq("ChatGPT is refused because there is no local source, not merely declared unavailable",
  TRACKER_SUPPORT_NOTICE.includes("ChatGPT is not tracked: browser and app leave no local source to read."), true);
eq("neither the browser nor the app is left as a maybe",
  /browser and app/.test(TRACKER_SUPPORT_NOTICE), true);
eq("four sentences, one fact each", TRACKER_SUPPORT_NOTICE.split(". ").length, 4);
eq("host observation is excluded, not advertised as collection", TRACKER_SUPPORT_DETAILS.includes("No monitoring of other apps, processes, windows, browsing, keyboard activity, computer idle or Git."), true);
eq("unknown models stay unknown and unsupported activity is not estimated", TRACKER_SUPPORT_DETAILS.includes("Unknown models stay unknown.") && TRACKER_SUPPORT_DETAILS.includes("Unsupported activity is not estimated."), true);
eq("setup does not install AI apps or connect provider accounts", TRACKER_SUPPORT_DETAILS.includes("Setup does not install AI apps or connect provider accounts."), true);
eq("connected and idle describe tracker transport and AI evidence, not computer activity", TRACKER_STATE_NOTICE, "Connected means a recent server-accepted tracker connection. Idle means no recent supported AI activity—not an idle computer.");
eq("the new policy does not erase or revalidate earlier public history", TRACKER_HISTORY_NOTICE.includes("applies going forward") && TRACKER_HISTORY_NOTICE.includes("Earlier public tracker history has not been erased or revalidated"), true);
eq("private key and retention are disclosed", PRIVATE_COMMAND_NOTICE.includes("device key") && PRIVATE_COMMAND_NOTICE.includes("may retain it"), true);
eq("Copy only copies", COPY_ONLY_NOTICE.includes("Copying does not run anything"), true);
eq("Revoke is not a promise of local shutdown or erasure", TRACKER_CONTROL_NOTICE.includes("does not guarantee local shutdown") && TRACKER_CONTROL_NOTICE.includes("Neither action erases history"), true);
eq("shared disclosure has no unsafe promises", UNSAFE_PROMISE.test([...DISCLOSURES, TRACKER_HISTORY_NOTICE].join(" ")), false);
eq("no notice or generated prompt advertises retired collection", [...DISCLOSURES, TRACKER_HISTORY_NOTICE, ...ALL.flatMap((target) => OSES.map((os) => promptFor(target, os)))].some((text) => LEGACY_COLLECTION_CLAIM.test(text)), false);

// ---- Cursor / Windsurf hook opt-in (docs/ARCHITECTURE.md 4.7) ----
//
// Same key-free family as start/status/stop: these lines are safe to share, and
// PRIVATE_COMMAND_NOTICE must never be attached to one. The tool id is an argument,
// so it is validated against the table rather than interpolated from free input.
// The four commands the product documents, byte for byte. These are literal CLI
// invocations, NOT the private-runtime wrapper the three tracker controls use: a
// wrapper would mean the line on screen is not the line a person can quote in a
// support thread, paste into a runbook or read back over a call. What the panel
// shows and what it copies are this same string (pinned in connectUx.check.mjs).
const HOOK_VERBS: HookVerb[] = ["install", "uninstall", "status"];
eq("install cursor is exactly the documented command", buildHooksCommand("install", "cursor"), "vibehub-tracker hooks install cursor");
eq("install windsurf is exactly the documented command", buildHooksCommand("install", "windsurf"), "vibehub-tracker hooks install windsurf");
eq("hooks status is exactly the documented command", buildHooksCommand("status"), "vibehub-tracker hooks status");
eq("uninstall cursor is exactly the documented command", buildHooksCommand("uninstall", "cursor"), "vibehub-tracker hooks uninstall cursor");
eq("uninstall windsurf is exactly the documented command", buildHooksCommand("uninstall", "windsurf"), "vibehub-tracker hooks uninstall windsurf");
eq("preview is the install command plus --dry-run and nothing else", buildHooksCommand("install", "cursor", true), "vibehub-tracker hooks install cursor --dry-run");
const HOOK_COMMANDS = [
  ...HOOK_VERBS.filter((verb) => verb !== "status").flatMap((verb) => HOOK_TOOL_IDS.map((tool) => buildHooksCommand(verb, tool))),
  ...HOOK_TOOL_IDS.map((tool) => buildHooksCommand("install", tool, true)),
  buildHooksCommand("status"),
];
eq("exactly the two hook tools are offered", [...HOOK_TOOL_IDS], ["cursor", "windsurf"]);
eq("the whole offered set is those lines and no others", HOOK_COMMANDS, [
  "vibehub-tracker hooks install cursor",
  "vibehub-tracker hooks install windsurf",
  "vibehub-tracker hooks uninstall cursor",
  "vibehub-tracker hooks uninstall windsurf",
  "vibehub-tracker hooks install cursor --dry-run",
  "vibehub-tracker hooks install windsurf --dry-run",
  "vibehub-tracker hooks status",
]);
const WRAPPER_MARKS = ["$HOME", "node ", "Test-Path", "if [", "& {", ".cjs", "2>", "vhNode"];
const SHELL_META = [";", "&", "|", "`", "$", "(", ")", "{", "}", "<", ">", "'", '"', "*"];
for (const command of HOOK_COMMANDS) {
  eq(`"${command}": names the CLI first`, command.startsWith("vibehub-tracker hooks "), true);
  eq(`"${command}": carries no runtime wrapper`, WRAPPER_MARKS.filter((mark) => command.includes(mark)), []);
  eq(`"${command}": carries no shell metacharacter`, SHELL_META.filter((ch) => command.includes(ch)), []);
  eq(`"${command}": is one copyable line`, /[\r\n]/.test(command), false);
  eq(`"${command}": carries no device key and no login`, command.includes(TOKEN) || /\blogin\b/.test(command), false);
  eq(`"${command}": has no path of any kind`, command.includes("/") || command.includes("~"), false);
}
// The same on both platforms, which is why the builder takes no InstallOs: there is
// no shell syntax in it to differ over.
eq("nothing about the command is OS-specific", new Set(HOOK_COMMANDS.map((c) => c.split(" ").length)).size <= 3, true);
eq("an unknown hook tool cannot be interpolated into a shell",
  ["", "cursor; id", "$(id)", "claude-code", "CURSOR", "cursor windsurf", null, undefined].every((tool) =>
    rejected(() => buildHooksCommand("install", tool as HookToolId))), true);
eq("an unknown hook verb cannot inject a command", rejected(() => buildHooksCommand("install; id" as HookVerb, "cursor")), true);
eq("per-tool verbs refuse to run without a tool", HOOK_VERBS.filter((verb) => verb !== "status").every((verb) =>
  rejected(() => buildHooksCommand(verb))), true);
eq("status refuses a tool rather than silently ignoring it", rejected(() => buildHooksCommand("status", "cursor")), true);
eq("preview is only meaningful on install", ["uninstall", "status"].every((verb) =>
  rejected(() => buildHooksCommand(verb as HookVerb, verb === "status" ? undefined : "cursor", true))), true);

eq("no generated command weakens policy or installs packages globally", [...OSES.flatMap((os) => [buildOneCommandConnect(os, TOKEN, API, WEB), buildInstallCommand(os, TOKEN, API, WEB), ...VERBS.map((verb) => buildTrackerCommand(os, verb))]), ...HOOK_COMMANDS].some((command) => /ExecutionPolicy|\bsudo\b|npm (?:i|install).* (?:-g|--global)|\b(?:brew|apt|winget|choco)\b|\bchmod\b/i.test(command)), false);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) throw new Error(`connectPrompt check failed: ${failures.join(", ")}`);
