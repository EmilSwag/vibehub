// Synthetic contract pins for the macOS install lane. Run: node web/scripts/run-checks.mjs macInstall
// No shell command, installer, network request, device key or real release is used here.
//
// What this file exists to stop regressing, from `meta/plans/vibehub-mac-app.md`:
//   FC4 — both Mac entrances are tokenless. No key in the command, argv, environment,
//         URL or deep link, and no reuse of the browser's stored connect token.
//   FC3 — release states are truthful. 404 is "not released yet", anything else is
//         "could not check", and a release without a checksum must not advertise a
//         command that `mac.sh` will abort.
import { readFileSync } from "node:fs";
import {
  MAC_APP_SCOPE,
  MAC_AUTOSTART_MEANS,
  MAC_CHECKSUM_MISSING,
  MAC_COMMAND_ERROR,
  MAC_COMMAND_MEANS,
  MAC_INSTALL_MEANS,
  MAC_KEY_ACTION,
  MAC_KEY_ERROR,
  MAC_KEY_ONCE,
  MAC_KEY_PENDING,
  MAC_KEY_PRIVATE,
  MAC_KEY_RETRY,
  MAC_KEY_TITLE,
  MAC_NOT_RELEASED,
  MAC_NOT_RELEASED_FIX,
  MAC_REQUIREMENTS,
  MAC_TOKEN_MEANS,
  MAC_TOKENLESS_NOTICE,
  MAC_UNAVAILABLE,
  buildMacInstallCommand,
  detectInstallChoice,
  macReleaseState,
  macReleaseStateFromError,
  parseMacRelease,
  scriptOs,
} from "../macInstall";
import type { InstallChoice, MacReleaseState } from "../macInstall";
import {
  BACKGROUND_START_MEANS,
  INSTALL_START_MEANS,
  PRIVATE_COMMAND_NOTICE,
} from "../connectPrompt";
import type { InstallOs } from "../connectPrompt";

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
  catch (error) { return error instanceof Error && error.message === MAC_COMMAND_ERROR; }
}

const API = "https://api.example.test";
const WEB = "https://web.example.test";
const SHA = "a".repeat(64);
const PAYLOAD = {
  version: "1.2.0",
  tag: "mac-v1.2.0",
  pkgUrl: "https://github.example.test/r/releases/download/mac-v1.2.0/VibeHub.pkg",
  sha256: SHA,
  zipUrl: "https://github.example.test/r/releases/download/mac-v1.2.0/VibeHub-macOS.zip",
  publishedAt: "2026-09-19T10:00:00Z",
};
const kind = (state: MacReleaseState) => state.kind;
const usable = (state: MacReleaseState) => (state.kind === "ready" ? state.commandUsable : null);

/* ---- FC4: the command is tokenless, and hardened like the existing connector ---- */

eq("install line is exactly the tokenless hardened one-liner", buildMacInstallCommand(API, WEB),
  `(set -o pipefail; curl -q --fail --silent --show-error --location --max-redirs 0 --proto '=https' --connect-timeout 20 --max-time 60 '${WEB}/tracker/mac.sh' | VIBEHUB_API_URL='${API}' VIBEHUB_WEB_URL='${WEB}' bash)`);

const COMMAND = buildMacInstallCommand(API, WEB);
eq("one copyable line", /[\r\n]/.test(COMMAND), false);
eq("no device key is passed by environment", COMMAND.includes("VIBEHUB_TOKEN"), false);
eq("no device key is passed by flag, stdin or argv", /--token|-Token|token-stdin|\btoken\b/i.test(COMMAND), false);
eq("no credential-bearing deep link", /vibehub:\/\//.test(COMMAND), false);
eq("no query string can smuggle a key into a URL", COMMAND.includes("?"), false);
eq("no handoff file is written by the copied line", /handoff/i.test(COMMAND), false);
eq("the script is the Mac installer, not the shell connector", COMMAND.includes("/tracker/mac.sh") && !COMMAND.includes("/tracker/connect."), true);
eq("a failed download cannot look like a successful empty install", COMMAND.startsWith("(set -o pipefail;") && COMMAND.endsWith(")"), true);
eq("local curl configuration is ignored and redirects refused", COMMAND.includes("curl -q ") && COMMAND.includes("--max-redirs 0"), true);
eq("the fetch cannot be downgraded off HTTPS", COMMAND.includes("--proto '=https'"), true);
eq("the fetch is bounded in time", COMMAND.includes("--connect-timeout 20") && COMMAND.includes("--max-time 60"), true);
eq("nothing weakens policy, escalates or installs packages globally",
  /ExecutionPolicy|\bsudo\b|npm (?:i|install).* (?:-g|--global)|\b(?:brew|apt|winget|choco)\b|\bchmod\b/i.test(COMMAND), false);
eq("only deployment origins are interpolated, both quoted",
  COMMAND.split("'").length - 1, 8);

// Origins are validated with connectPrompt's audited rules, not a second looser copy.
const BAD_ORIGINS = [
  "", "https:example.test", "//example.test", "http://example.test", "file:///tmp/a", "javascript:alert(1)",
  "https://user:password@example.test", "https://example.test/api", "https://example.test?x=1", "https://example.test#fragment",
  "https://example.test'; id #", 'https://example.test/";Write-Output bad', "https://example.test/$(id)",
  "https://example.test/`id`", "https://example.test\\evil", "https://exam\nple.test", "https://exam\tple.test", "https://exam\u0000ple.test",
];
eq("unsafe API origins predictably reject", BAD_ORIGINS.every((url) => rejected(() => buildMacInstallCommand(url, WEB))), true);
eq("unsafe web origins predictably reject", BAD_ORIGINS.every((url) => rejected(() => buildMacInstallCommand(API, url))), true);
eq("origins are normalized, not double-slashed", buildMacInstallCommand(`${API}/`, `${WEB}/`), COMMAND);
eq("loopback previews stay supported and declare their protocols",
  buildMacInstallCommand("http://127.0.0.1:4000", "http://localhost:5173").includes("--proto '=http,https'"), true);

/* ---- FC3: honest release states ---- */

eq("a complete payload is a real release", kind(macReleaseState(PAYLOAD)), "ready");
eq("a complete payload offers the command", usable(macReleaseState(PAYLOAD)), true);
eq("the parsed release keeps the server's facts", parseMacRelease(PAYLOAD), {
  version: "1.2.0",
  tag: "mac-v1.2.0",
  pkgUrl: PAYLOAD.pkgUrl,
  sha256: SHA,
  zipUrl: PAYLOAD.zipUrl,
  publishedAt: PAYLOAD.publishedAt,
});
eq("an uppercase digest is accepted and normalized", parseMacRelease({ ...PAYLOAD, sha256: SHA.toUpperCase() })?.sha256, SHA);

// A missing checksum must not silently become an install. `mac.sh` aborts on a null
// sha256, so the web must offer the download and withhold the command.
eq("a release without a checksum is still downloadable", kind(macReleaseState({ ...PAYLOAD, sha256: null })), "ready");
eq("a release without a checksum does not advertise the command", usable(macReleaseState({ ...PAYLOAD, sha256: null })), false);
eq("a missing sha256 key behaves like an explicit null", usable(macReleaseState({ ...PAYLOAD, sha256: undefined })), false);
for (const bad of ["", "not-a-digest", SHA.slice(0, 63), `${SHA}0`, "g".repeat(64), 1234, {}, []]) {
  eq(`a malformed digest (${JSON.stringify(bad)}) is treated as absent, never trusted`, usable(macReleaseState({ ...PAYLOAD, sha256: bad })), false);
}

// Never a dead download button: anything that cannot produce a real https pkg URL is
// "could not check", not a rendered link.
for (const bad of [null, undefined, "", 42, [], { version: "1.0.0", tag: "mac-v1.0.0" }]) {
  eq(`an unusable body (${JSON.stringify(bad) ?? "undefined"}) is not a release`, kind(macReleaseState(bad)), "unavailable");
}
for (const pkgUrl of ["", "not a url", "http://insecure.test/VibeHub.pkg", "file:///VibeHub.pkg", "javascript:alert(1)", "https://a.test/a b.pkg", 7, null]) {
  eq(`a non-https package URL (${JSON.stringify(pkgUrl)}) never becomes a button`, kind(macReleaseState({ ...PAYLOAD, pkgUrl })), "unavailable");
}
eq("a missing version or tag is not a release we can name",
  [kind(macReleaseState({ ...PAYLOAD, version: "" })), kind(macReleaseState({ ...PAYLOAD, tag: null }))], ["unavailable", "unavailable"]);
eq("a bad zip URL does not sink an otherwise good release",
  [kind(macReleaseState({ ...PAYLOAD, zipUrl: "nope" })), parseMacRelease({ ...PAYLOAD, zipUrl: "nope" })?.zipUrl], ["ready", null]);

eq("404 is the only 'not released yet'", kind(macReleaseStateFromError({ status: 404 })), "none");
for (const error of [{ status: 503 }, { status: 500 }, { status: 502 }, { status: 429 }, { status: 401 }, new Error("offline"), null, undefined, "boom"]) {
  eq(`a non-404 failure (${JSON.stringify(error) ?? "thrown"}) is 'could not check', not 'no app'`, kind(macReleaseStateFromError(error)), "unavailable");
}

/* ---- picker ---- */

const CHOICES: InstallChoice[] = ["mac-app", "mac", "windows"];
eq("every choice resolves to a real script OS", CHOICES.map(scriptOs), ["mac", "mac", "windows"] as InstallOs[]);
eq("Windows never lands on the Mac app tab", detectInstallChoice("windows"), "windows" as InstallChoice);
eq("a non-Windows device never lands on the Windows tab", detectInstallChoice("mac") === "windows", false);

/* ---- copy ----
 *
 * The three connector notices below are true of the shell script and false of the app.
 * The Mac panel must never reuse them, and must say the opposite where the opposite is
 * what happens (it does autostart at login, it does carry no key).
 */

const MAC_COPY = [MAC_APP_SCOPE, MAC_INSTALL_MEANS, MAC_TOKENLESS_NOTICE, MAC_TOKEN_MEANS,
  MAC_AUTOSTART_MEANS, MAC_COMMAND_MEANS, MAC_CHECKSUM_MISSING, MAC_NOT_RELEASED,
  MAC_NOT_RELEASED_FIX, MAC_UNAVAILABLE, MAC_REQUIREMENTS, MAC_KEY_TITLE, MAC_KEY_ACTION,
  MAC_KEY_RETRY, MAC_KEY_PENDING, MAC_KEY_ONCE, MAC_KEY_PRIVATE, MAC_KEY_ERROR];
const MAC_TEXT = MAC_COPY.join(" ");

eq("the app does not borrow the connector's install/start, autostart or key notices",
  MAC_COPY.some((text) => [INSTALL_START_MEANS, BACKGROUND_START_MEANS, PRIVATE_COMMAND_NOTICE].includes(text)), false);
eq("the app never repeats the connector's 'No OS autostart'", MAC_TEXT.includes("No OS autostart"), false);
eq("login resumption is disclosed", /resumes at login/i.test(MAC_AUTOSTART_MEANS), true);
eq("tracking is not claimed to start on install", /Nothing is tracked yet/.test(MAC_INSTALL_MEANS), true);
eq("turning tracking off is stated to persist", /off stays off/i.test(MAC_AUTOSTART_MEANS), true);
eq("both entrances are stated to carry no key", /carry no device key/.test(MAC_TOKENLESS_NOTICE), true);
eq("the key is asked for in the app, not the browser", /asks for a device key on first launch/.test(MAC_TOKEN_MEANS), true);
// The guidance must resolve on this panel. Pointing at "Settings → Tracker" from inside
// Settings → Tracker is the circular instruction this replaced.
eq("the guidance resolves here instead of pointing back at this page",
  /Create one below and paste it into the app\./.test(MAC_TOKEN_MEANS) && !/Settings . Tracker/.test(MAC_TOKEN_MEANS), true);
eq("issuing a key is offered as an explicit action", MAC_KEY_ACTION, "Create a device key");
eq("an issued key is stated to be unsaved and one-shot",
  /Shown once/.test(MAC_KEY_ONCE) && /not saved in this browser/.test(MAC_KEY_ONCE), true);
eq("an issued key is marked private and pointed at the app, not a terminal",
  /reports as you/.test(MAC_KEY_PRIVATE) && /Paste it into VibeHub, not into a terminal/.test(MAC_KEY_PRIVATE), true);
eq("key issuance has its own recoverable error", /Could not create a device key/.test(MAC_KEY_ERROR), true);
eq("not-released copy says exactly that", MAC_NOT_RELEASED, "VibeHub for Mac is not released yet.");
eq("an unchecked release is not reported as an absent one", MAC_UNAVAILABLE.includes("Could not check"), true);
eq("the missing-checksum case sends the user to the download", /use the download/i.test(MAC_CHECKSUM_MISSING), true);
eq("no Mac copy promises a key, a deep link or an env var",
  /VIBEHUB_TOKEN|vibehub:\/\/|paste your token into the command|token in the (?:URL|link)/i.test(MAC_TEXT), false);
eq("no Mac copy makes an audited blanket privacy guarantee",
  /reads no file contents|only metadata(?: is)? (?:read|collected)|never reads? (?:your )?prompts|prompts (?:are )?never read|stats (?:are )?private|all AI (?:apps|models) (?:work|are tracked)/i.test(MAC_TEXT), false);
eq("no Mac copy claims process, window or other-app monitoring",
  /process(?: and window|\/window)|window titles|including unrelated apps|keyboard/i.test(MAC_TEXT), false);
eq("no Mac copy widens supported tools beyond the shared notice",
  /all IDEs|every AI tool|any AI tool|Cursor|Windsurf|Copilot/i.test(MAC_TEXT), false);
eq("no hedging filler in the Mac copy", /\b(?:simply|just|easily|basically|in order to)\b/i.test(MAC_TEXT), false);

/* ---- source pins: selecting the Mac tab must never mint or cache ----
 *
 * Reads the named frontend sources only. No render, no API, no browser. These are the
 * mechanical half of FC4: the copy above promises the key is issued on demand and never
 * stored, and these make that promise hard to regress.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/** Comments explain what the code must never do, and name the very things these pins
 *  forbid. Pin the code, not the prose: block and line comments are stripped first
 *  (`//` after a colon is left alone so a URL in a string survives). */
function codeOf(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** The exact argument text of each `name(...)` call, by paren matching — so an effect
 *  body is the effect body, not a fixed window that swallows the next declaration. */
function callsOf(text: string, name: string): string[] {
  const calls: string[] = [];
  const token = `${name}(`;
  for (let at = text.indexOf(token); at >= 0; at = text.indexOf(token, at + 1)) {
    let depth = 0;
    for (let i = at + token.length - 1; i < text.length; i += 1) {
      if (text[i] === "(") depth += 1;
      else if (text[i] === ")") {
        depth -= 1;
        if (depth === 0) { calls.push(text.slice(at, i + 1)); break; }
      }
    }
  }
  return calls;
}

const panel = codeOf(read("../../components/MacInstall.tsx"));
const settings = codeOf(read("../../components/ConnectTools.tsx"));
const sheet = codeOf(read("../../components/connect/ConnectSheet.tsx"));

const STORAGE = ["localStorage", "sessionStorage", "vh-connect-token", "readStoredConnectToken",
  "writeStoredConnectToken", "clearStoredConnectToken", "ensureConnectToken"];
eq("the Mac panel touches no browser storage and no stored connect token",
  STORAGE.filter((name) => panel.includes(name)), []);
eq("the Mac panel imports only the pure device-label helper from connectToken",
  /import \{ deviceLabel \} from "\.\.\/lib\/connectToken";/.test(panel), true);
eq("the Mac panel mints in exactly one place", panel.split("createTrackerToken").length - 1, 1);
eq("that one mint lives in an explicit named action", panel.includes("const issueDeviceKey = useCallback("), true);
eq("the mint is reachable only from a click", panel.includes("onClick={() => void issueDeviceKey()}"), true);
eq("no effect mints on mount — choosing the tab only reads the release endpoint",
  callsOf(panel, "useEffect").filter((body) => body.includes("createTrackerToken")), []);
eq("the release lookup is the only thing mounting triggers",
  callsOf(panel, "useEffect").some((body) => body.includes("macApi")), true);
eq("the download link carries the package URL and nothing else",
  /href=\{state\.release\.pkgUrl\}/.test(panel) && !/href=\{[^}]*token/i.test(panel), true);
eq("no deep link or token-bearing URL is constructed", /vibehub:\/\/|[?&]token=/.test(panel), false);
eq("an issued key is rendered for reading, never auto-executed",
  panel.includes("navigator.clipboard.writeText") && !/\beval\(|new Function\(/.test(panel), true);

eq("Settings reuses the key Add device already minted, rather than minting a second",
  settings.includes("<MacInstall token={token} />"), true);
eq("the sheet does not hand its cached key to the Mac panel",
  sheet.includes("<MacInstall />") && !/MacInstall token=/.test(sheet), true);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) throw new Error(`macInstall check failed: ${failures.join(", ")}`);
