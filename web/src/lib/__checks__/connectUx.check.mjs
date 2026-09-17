// Source-only regression pins, not a browser or accessibility-runtime test.
// Run: node web/src/lib/__checks__/connectUx.check.mjs
// Reads only the named frontend sources. No app import, API, shell or real data.
import { readFileSync } from "node:fs";
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
function visibleCopy(text) {
  return parse(text).flatMap(({ node }) => ts.isJsxText(node) || ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)
    ? [node.text] : []).join(" ");
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

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) throw new Error(`connectUx source checks failed: ${failures.join(", ")}`);
