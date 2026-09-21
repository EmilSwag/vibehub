// Source-only regression pins, not a browser or accessibility-runtime test.
// Run: node web/src/lib/__checks__/connectUx.check.mjs
// Reads frontend sources only — the named ones, plus a sweep of every file under
// src/ for the hardcoded-tool-list guard. No app import, API, shell or real data.
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const notices = read("../connectPrompt.ts");
const ping = read("../trackerPing.ts");
const hook = read("../useTrackerPing.ts");
const api = read("../api.ts");
const home = read("../../pages/HomePage.tsx");
const sheet = read("../../components/connect/ConnectSheet.tsx");
const settings = read("../../components/ConnectTools.tsx");
const status = read("../../components/TrackingStatus.tsx");
const onboarding = read("../../pages/onboarding/StepConnect.tsx");
const celebration = read("../../components/ui/ConnectCelebration.tsx");
const hooks = read("../../components/connect/HookTools.tsx");
const hooksCss = read("../../components/connect/HookTools.module.css");
const models = read("../../components/RecentModels.tsx");
const table = read("../supportedTools.ts");
const sheetCss = read("../../components/connect/ConnectSheet.module.css");
const settingsCss = read("../../components/ConnectTools.module.css");
let passed = 0;
const failures = [];
function check(label, condition) {
  if (condition) { passed++; console.log(`ok   ${label}`); }
  else { failures.push(label); console.log(`FAIL ${label}`); }
}
function parse(text) {
  const tree = ts.createSourceFile("fixture.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const nodes = [];
  function visit(node, ancestors = []) {
    nodes.push({ node, ancestors });
    ts.forEachChild(node, (child) => visit(child, [...ancestors, node]));
  }
  visit(tree);
  return nodes;
}
function isConditional(node) {
  return ts.isConditionalExpression(node) || ts.isIfStatement(node) ||
    (ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind));
}
function foregroundRef(nodes, name, before) {
  return nodes.some(({ node, ancestors }) => ts.isJsxExpression(node) &&
    node.expression && ts.isIdentifier(node.expression) && node.expression.text === name &&
    node.pos < before && !ancestors.some(isConditional));
}
function renderedRef(text, name) {
  return parse(text).some(({ node }) => ts.isJsxExpression(node) &&
    node.expression && ts.isIdentifier(node.expression) && node.expression.text === name);
}
function copyLiterals(text) {
  return parse(text).flatMap(({ node }) => ts.isJsxText(node) || ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)
    ? [node.text] : []);
}
function visibleCopy(text) {
  return copyLiterals(text).join(" ");
}

for (const [label, text, css] of [["sheet", sheet, sheetCss], ["Settings Add device", settings, settingsCss]]) {
  const nodes = parse(text);
  const commandAt = text.indexOf('aria-label="Install and start command"');
  check(`${label}: primary command exists`, commandAt >= 0);
  check(`${label}: exactly one primary install/start label`, text.split('"Copy install & start"').length - 1 === 1);
  check(`${label}: shared one-command builder is wired`, /buildOneCommandConnect\(os, (?:token\.token|token), API_BASE, WEB_URL\)/.test(text));
  check(`${label}: OS, not provider, is the primary chooser`, text.includes('aria-label="Operating system"') && text.includes('role="group"') && text.includes('aria-pressed={value === os.id}'));
  check(`${label}: no provider tabs or per-provider target selector`, !/role="tab(?:list)?"|const TARGETS|setTarget\(|pick how you work/i.test(text));
  for (const name of ["DEVICE_CONNECT_SCOPE", "NODE_SETUP_NOTICE", "INSTALL_START_MEANS", "BACKGROUND_START_MEANS", "TRACKER_LOCAL_READS", "TRACKER_UPLOADS", "TRACKER_VISIBILITY", "PRIVATE_COMMAND_NOTICE", "COPY_ONLY_NOTICE"]) {
    check(`${label}: ${name} is unconditional before the command`, foregroundRef(nodes, name, commandAt));
  }
  check(`${label}: data detail is an accessible disclosure`, /aria-expanded=\{detailsOpen\}/.test(text) && text.includes('aria-controls={`${id}-data`}') && text.includes('id={`${id}-data`}'));
  check(`${label}: assistant setup is a secondary disclosure`, /aria-expanded=\{assistantOpen\}/.test(text) && text.includes("Ask your AI assistant") && text.includes('variant="secondary"'));
  check(`${label}: assistant prompt is generic and OS-matched`, /buildConnectPrompt\("assistant", (?:token\.token|token), API_BASE, WEB_URL, os\)/.test(text));
  check(`${label}: assistant is a place to run setup, not tracking scope`, /where you run setup, not what gets tracked/.test(text));
  check(`${label}: ChatGPT inability is visible`, /ChatGPT can guide you but cannot run commands on your device/.test(text));
  check(`${label}: status/stop/reconnect stay secondary`, text.includes('aria-expanded={controlsOpen}') && text.includes("buildStatusCommand(os)") && text.includes("buildStopCommand(os)") && text.includes("buildStartCommand(os)"));
  check(`${label}: commands can be keyboard-selected after clipboard failure`, /<pre[^>]+tabIndex=\{0\}/.test(text) && text.includes("select and copy the text above"));
  check(`${label}: clipboard writes, never command execution`, text.includes("navigator.clipboard.writeText") && !/\beval\(|new Function\(|child_process|\/tracker\/connect\.(?:sh|ps1)/.test(text));
  check(`${label}: per-user remount prevents old-account state`, text.includes('key={user?.id ?? "signed-out"}'));
  check(`${label}: visible focus and 44px targets are styled`, css.includes(":focus-visible") && css.includes("min-height: 44px"));
  check(`${label}: obsolete manual prerequisites and split instructions are gone`, !/Needs Node\.js 18|Run step 2|Redo step 1|Then start it/.test(visibleCopy(text)));
}

check("sheet: fresh-heartbeat hook still owns success", sheet.includes("useTrackerPing(open, started)") && sheet.includes("shouldCelebrate(ping.stage, ping.liveAtOpen)"));
check("sheet: existing-live is informational", sheet.includes('const showProgress = !ping.liveAtOpen && ping.stage !== "idle"'));
check("sheet: opening/retrying revalidates via existing token helper", sheet.includes("ensureConnectToken(userId") && sheet.includes("}, [open, userId, retry])"));
check("sheet: late token and clipboard responses are cancelled", sheet.includes("if (!cancelled)") && sheet.includes("if (stale()) return"));
check("sheet: onStarted state remains wired", sheet.includes("setStarted(true)") && sheet.includes("onStarted?.()"));
check("sheet: failed copy cannot earn a copied checkmark", sheet.indexOf("await navigator.clipboard.writeText(value)") < sheet.indexOf("setAttemptCopy(what)"));
check("sheet: dialog, Escape, Tab trap and return focus remain", sheet.includes('role="dialog"') && sheet.includes('aria-modal="true"') && sheet.includes('event.key === "Escape"') && sheet.includes('event.key !== "Tab"') && sheet.includes("event.shiftKey") && sheet.includes("opener.current?.focus()"));
check("sheet: closing does not steal the celebration Enter focus", sheet.includes("dialog.current?.contains(active)"));
check("sheet: reduced-motion scroll and safe-area scrolling remain", sheet.includes('reduced ? "auto" : "smooth"') && sheetCss.includes("prefers-reduced-motion: reduce") && sheetCss.includes("env(safe-area-inset-bottom)"));
check("Settings: status comes from authoritative observations, not presence-word merges", settings.includes("observePing(previous, next)") && !settings.includes("connected: me.status"));
check("Settings: celebration requires a newer server heartbeat", settings.includes("!newer(status.lastSeenAt, observation.baselineAt)") && settings.includes("observation.liveAtOpen"));
check("Settings: a poll cannot repeatedly celebrate when storage is unavailable", settings.includes("celebrationAttempted.current = true"));
check("Settings: opening an already-live sheet does not auto-close each poll", settings.includes("connected && !previouslyConnected.current"));
check("Settings: Add device does not fold on key verification alone", settings.includes("!newer(status.lastSeenAt, deviceToken.baselineAt)") && settings.includes("deviceToken.tokenId)?.lastUsedAt"));
check("Settings: failed status has an explicit retry", settings.includes("Could not check tracker status") && settings.includes("Retry status check"));
check("connected users can reach secondary Stop without Add device", status.includes("!offline && onGoOnline") && status.includes("Status, Stop &amp; reconnect"));
check("onboarding names one device-wide connection", onboarding.includes("Connect VibeHub once") && renderedRef(onboarding, "DEVICE_CONNECT_SCOPE"));
check("onboarding explicitly names current support", renderedRef(onboarding, "TRACKER_SUPPORT_NOTICE"));
for (const [label, text] of [["sheet", sheet], ["Settings", settings], ["Home/Settings status", status]]) {
  for (const name of ["TRACKER_LOCAL_READS", "TRACKER_UPLOADS", "TRACKER_VISIBILITY", "TRACKER_SUPPORT_NOTICE", "TRACKER_STATE_NOTICE", "TRACKER_HISTORY_NOTICE"]) {
    check(`${label}: renders shared ${name}`, renderedRef(text, name));
  }
}
check("both setup disclosures retain source exclusions and unknown-model limits", [sheet, settings].every((text) => renderedRef(text, "TRACKER_SUPPORT_DETAILS")));
check("Home mounts the shared connection banner", home.includes('<ConnectTools variant="banner" />'));
check("API preserves the server's connected flag and idle presence", api.includes("connected: raw.connected ?? false") && api.includes("presence: raw.presence ??"));
check("hook and Home wrapper use transport evidence, not an active-only test", hook.includes("presenceActive: connectionAlive(status)") && settings.includes('hasHeartbeat && connectionAlive(status)'));
check("hook keeps the authoritative observation and first-connection baseline", hook.includes("status: observePing(visibleSnapshot(previous, mySession), next)"));
check("Home panel and strip keep the existing literal Idle title", status.includes('if (status.presence.status === "idle") return "Idle";') && status.split("{trackerTitle(status)}").length - 1 === 2);
check("Home does not invent an activity row for an idle connection", status.includes('const running = !offline && status.presence.activity !== null;') && status.includes("No recent supported AI activity"));
check("celebration Enter and autofocus are unchanged", celebration.includes("autoFocus") && /<Button[^>]+onClick=\{onClose\}[^>]*>[\s\r\n]*Enter/.test(celebration));
check("celebration does not imply every AI product connected", celebration.includes('const WORDS = ["VibeHub", "connected."]'));
const copy = [notices, sheet, settings, status, onboarding, celebration, ping].map(visibleCopy).join(" ");
check("copy no longer claims broad process/window or Quadcode collection", !/reads (?:local )?process(?: and window|\/window)|including unrelated apps|log readers cover[^.]*Quadcode|other app detections can use process\/window/i.test(copy));
check("on-screen copy has no audited blanket privacy guarantees", !/Never (?:your )?code(?:,| or) prompts|Only status, hours and tokens|reads no file contents|only metadata(?: is)? (?:read|collected)|nothing unrelated (?:is )?collected|never reads? (?:your )?prompts|prompts (?:are )?never read|stats (?:are )?private|all AI apps work/i.test(copy));
check("connected copy distinguishes remote revoke from local shutdown/history", copy.includes("removes reporting authorization") && copy.includes("not guaranteed local shutdown or history erasure"));

// ---- Cursor / Windsurf opt-in, and the guard that keeps it derived ----
//
// The tool list lives in ONE place (lib/supportedTools.ts). A view that spells it out
// by hand is how the client ended up telling people Cursor was unavailable months
// after the tracker started accepting it, so that is a check failure here, not a
// style note. Names are read out of the table's own source rather than retyped.
// Every name the table knows — the five supported tools AND the one named as not
// tracked. A view must not hardcode a list of either kind, so both feed the guard.
const TOOL_NAMES = [...table.matchAll(/copyName: "([^"]+)"/g)].map((m) => m[1]);
check("the tool table is readable: five supported tools plus the one named as untracked",
  TOOL_NAMES.length === 6 && [...table.matchAll(/\{ id: "/g)].length === 5);
// EVERY source file, not a hand-kept list of surfaces: a view added next month is
// covered without anyone remembering to extend this check. Walking the tree is the
// point — a named list is exactly how the old "Cursor is unavailable" copy survived
// in files nobody thought to look at.
//
// Two modules are allowed to name tools, because naming them is their job: the table
// itself and the copy module that renders it. Everything else — every component,
// page, hook and helper, present or future — must go through the table.
const SRC_DIR = fileURLToPath(new URL("../../", import.meta.url));
const COPY_OWNERS = ["lib/supportedTools.ts", "lib/connectPrompt.ts"];
const relPath = (file) => relative(SRC_DIR, file).split(sep).join("/");
function allSources(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // The checks themselves quote copy on purpose; that is what pinning is.
      if (entry.name !== "__checks__") out.push(...allSources(full));
    } else if (/[.]tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}
const everySource = allSources(SRC_DIR);
const swept = everySource.filter((file) => !COPY_OWNERS.includes(relPath(file)));
check(`the sweep reaches the whole client, not a sample (${swept.length} files)`, swept.length >= 80);
check("both copy owners exist, and they are the only files exempt",
  COPY_OWNERS.every((owner) => everySource.some((file) => relPath(file) === owner)) &&
  everySource.length - swept.length === COPY_OWNERS.length);
const spelled = [];
for (const file of swept) {
  for (const literal of copyLiterals(readFileSync(file, "utf8"))) {
    const named = TOOL_NAMES.filter((name) => literal.includes(name));
    if (named.length >= 2) spelled.push(`${relPath(file)} [${named.join("+")}] ${literal.trim().slice(0, 50)}`);
  }
}
check(`no file outside the copy owners spells a tool list out by hand${spelled.length ? " :: " + spelled.slice(0, 3).join(" | ") : ""}`,
  spelled.length === 0);
// The guard has to be able to fail, or it proves nothing.
check("the guard catches a hand-written pair when one exists",
  TOOL_NAMES.filter((name) => `we track ${TOOL_NAMES[0]} and ${TOOL_NAMES[1]} here`.includes(name)).length >= 2);
check("the unmeasured phrase is one shared constant, not retyped per view",
  [status, celebration, models].every((text) => !copyLiterals(text).some((literal) => literal.includes("tokens not reported"))) &&
  [status, celebration, models].every((text) => text.includes("TOKENS_NOT_REPORTED")));
check("both today counters can say a tokenless day is unmeasured, not zero",
  [status, celebration].every((text) => text.includes("today.tokensReported ?")));
// Found by browser QA: the counters were fixed but the per-source Models rows still
// printed "0 today" for a hook tool, which is the same measured-nothing claim.
check("a per-source row for a tokenless tool says so instead of printing a zero",
  status.includes("isTokenlessTool(source.tool) && source.tokensToday === 0 ? TOKENS_NOT_REPORTED"));
check("the model rows read tokenless off the grouping, not off a second local list",
  models.includes("tokenless: row.tokenless") && !models.includes("ESTIMATED_TOOL_FAMILIES"));

for (const [label, text] of [["sheet", sheet], ["Settings Add device", settings]]) {
  check(`${label}: the hook opt-in is mounted beside the primary command`, text.includes("<HookTools />"));
}
check("onboarding keeps one primary action and does not add a second install path", !onboarding.includes("HookTools"));
check("the opt-in stays a closed secondary disclosure", hooks.includes("aria-expanded={open}") && hooks.includes('aria-controls={`${id}-hooks`}'));
check("the opt-in enumerates the table, never two hardcoded tools", hooks.includes("HOOK_TOOLS.map("));
check("every hook command comes from the shared validated builder", hooks.includes("buildHooksCommand(chosen.id, tool.id, chosen.dryRun)") && hooks.includes('buildHooksCommand("status")'));
// What is on screen and what lands on the clipboard are the SAME identifier. A
// second expression here is how a panel ends up showing one command and copying
// another, which is unfixable from a screenshot.
check("the copied text is the identifier that is rendered, not a second expression",
  hooks.includes("<pre className={styles.cmd} tabIndex={0} aria-label={`${label} command`}>{command}</pre>") &&
  hooks.includes("onClick={() => void copy(what, command)}"));
check("the panel shows the literal CLI line, never the private-runtime wrapper",
  !hooks.includes("$HOME") && !hooks.includes("buildTrackerCommand") && !hooks.includes("cliCommand"));
check("install, preview and remove are all reachable", ["install", "uninstall"].every((verb) => hooks.includes(`id: "${verb}"`)) && hooks.includes("dryRun: true"));
check("each tool is shown with its own monochrome mark beside its name", hooks.includes("<ToolGlyph family={tool.id}") && hooks.includes("{toolLabel(tool.id)}"));
check("the opt-in copies, it never executes", hooks.includes("navigator.clipboard.writeText") && !/\beval\(|new Function\(|child_process/.test(hooks));
check("a failed hook copy earns no checkmark and offers manual selection",
  hooks.indexOf("await navigator.clipboard.writeText(text)") < hooks.indexOf("setCopied(what)") && hooks.includes("select and copy the text above"));
check("hook commands can be keyboard-selected", /<pre[^>]+tabIndex=\{0\}/.test(hooks));
check("the hook block states its scope, what is written, and how to undo it",
  ["HOOKS_SCOPE", "HOOKS_REPORTS", "HOOKS_WRITES", "HOOKS_CLI_REQUIREMENT"].every((name) => renderedRef(hooks, name)));
check("the hook block's own controls are focusable and touch-sized", hooksCss.includes(":focus-visible") && hooksCss.includes("min-height: 44px"));


console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) throw new Error(`connectUx source checks failed: ${failures.join(", ")}`);
