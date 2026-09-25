// VibeHub for Mac — the web half of the native install lane (plan `meta/plans/vibehub-mac-app.md`).
//
// TOKENLESS, both entrances (FC4). The .pkg download and the `curl … | bash` line carry
// no device key: not in the URL, not in argv, not in the environment. VibeHub asks for
// the key once, in its own onboarding. Nothing in this module mints, reads or stores a
// token, and nothing here touches `connectToken.ts`'s `vh-connect-token:<userId>` entry —
// that stays with the untouched Windows/Linux script flow.
//
// TRUTHFUL RELEASE STATES (FC3). `GET /api/v1/mac/latest` answers a payload, 404
// `no_release` before the first `mac-v*` tag, or 503 when GitHub is unreachable with
// nothing cached. Those map to four states and never to a dead download button. A
// release whose `sha256` is missing is shown as a download that works and a command
// that does not — `mac.sh` aborts on a null checksum rather than installing unverified,
// so offering the command there would be a lie.
//
// Pure on purpose: no `api.ts` import (that module reads `import.meta.env` at load) and
// no browser access at module scope, so `__checks__/macInstall.check.ts` can import it
// under plain Node. Pinned by that check.

import { assertOrigin } from "./connectPrompt";
import type { InstallOs } from "./connectPrompt";

/** What the install picker offers. `mac-app` is the native app; the other two are the
 *  unchanged shell-script flows, so `InstallOs` keeps exactly its two old members. */
export type InstallChoice = InstallOs | "mac-app";

/** Which script flow a choice belongs to. `mac-app` has no script; it maps to the POSIX
 *  builders only so existing call sites keep a valid `InstallOs` while that tab is open. */
export function scriptOs(choice: InstallChoice): InstallOs {
  return choice === "windows" ? "windows" : "mac";
}

/** True only on a Mac. `detectOs()` answers "Windows or not", which cannot tell macOS
 *  from Linux — and only macOS gets the app. `navigator.platform` is deprecated but is
 *  still the most reliable tell; the user agent is the fallback. */
function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac/i.test(navigator.platform ?? "") || /Macintosh|Mac OS X/i.test(navigator.userAgent ?? "");
}

/** The tab this device should land on. Takes the already-detected OS so `detectOs()`
 *  stays the single authority on Windows and this only adds the macOS/Linux split. */
export function detectInstallChoice(os: InstallOs): InstallChoice {
  if (os === "windows") return "windows";
  return isMacPlatform() ? "mac-app" : "mac";
}

/* ---- Release facts (FC3) ---- */

/** `GET /api/v1/mac/latest`, validated. Mirrors the server's `MacLatestPayload`. */
export interface MacRelease {
  version: string;
  tag: string;
  pkgUrl: string;
  /** Contents of the `.sha256` asset, or null when that asset is missing. */
  sha256: string | null;
  zipUrl: string | null;
  publishedAt: string | null;
}

/**
 * The four honest answers, and nothing in between:
 * - `loading`  — the request is in flight; the UI shows a shape-matched skeleton.
 * - `ready`    — a real release. `commandUsable` is false when its checksum is missing.
 * - `none`     — 404 `no_release`: not released yet. No download button at all.
 * - `unavailable` — 503 / network / malformed payload: we do not know, and say so.
 */
export type MacReleaseState =
  | { kind: "loading" }
  | { kind: "ready"; release: MacRelease; commandUsable: boolean }
  | { kind: "none" }
  | { kind: "unavailable" };

const MAX_URL = 2048;

/** An https download URL, or null. Anything else must not become a button. */
function downloadUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_URL) return null;
  if (/[\s<>"'`\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname ? url.toString() : null;
  } catch {
    return null;
  }
}

/** A 64-hex digest, lower-cased, or null. A malformed digest is treated as absent:
 *  the command aborts either way, so pretending we have one would be worse. */
function digest(value: unknown): string | null {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value) ? value.toLowerCase() : null;
}

function label(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}

/** Compare semantic versions (e.g. "1.1.0" >= "1.0.0"). */
export function isVersionAtLeast(version: string, target: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const [a1 = 0, a2 = 0, a3 = 0] = parse(version);
  const [b1 = 0, b2 = 0, b3 = 0] = parse(target);
  if (a1 !== b1) return a1 > b1;
  if (a2 !== b2) return a2 > b2;
  return a3 >= b3;
}

/** The payload if it can actually drive a download, else null. */
export function parseMacRelease(raw: unknown): MacRelease | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const pkgUrl = downloadUrl(source.pkgUrl);
  const version = label(source.version, 64);
  const tag = label(source.tag, 128);
  if (!pkgUrl || !version || !tag) return null;
  return {
    version,
    tag,
    pkgUrl,
    sha256: digest(source.sha256),
    zipUrl: downloadUrl(source.zipUrl),
    publishedAt: label(source.publishedAt, 64),
  };
}

/** A successful response → `ready`, or `unavailable` when the body cannot be trusted. */
export function macReleaseState(raw: unknown): MacReleaseState {
  const release = parseMacRelease(raw);
  if (!release) return { kind: "unavailable" };
  return { kind: "ready", release, commandUsable: release.sha256 !== null };
}

/**
 * A failed response → `none` only for 404. Everything else (503 `github_unavailable`,
 * a proxy 5xx, an offline browser) is `unavailable`: "we could not check" is a different
 * claim from "there is no Mac app", and only one of them is true here.
 */
export function macReleaseStateFromError(error: unknown): MacReleaseState {
  const status = error && typeof error === "object" ? (error as { status?: unknown }).status : undefined;
  return status === 404 ? { kind: "none" } : { kind: "unavailable" };
}

/* ---- The one command (FC4) ---- */

export const MAC_COMMAND_ERROR = "Could not prepare the install command. Reload Settings or contact support.";

/**
 * `curl … | bash` for `web/public/tracker/mac.sh` — the same `VibeHub.pkg` the download
 * button resolves, installed without a Terminal-entered key.
 *
 * Hardened exactly like the existing connector line: subshell `pipefail` so a failed
 * download cannot look like a successful empty install, `-q` to ignore local curl
 * config, no redirects, a pinned protocol, and bounded timeouts.
 *
 * The two environment values are deployment origins, never a credential — they point
 * the script at the server this web app talks to, so a staging page cannot hand out a
 * production installer. HTTP is only reachable for the loopback previews `assertOrigin`
 * already allows.
 */
export function buildMacInstallCommand(apiUrl: string, webUrl: string): string {
  let api: string;
  let web: string;
  try {
    api = assertOrigin(apiUrl);
    web = assertOrigin(webUrl);
  } catch {
    throw new Error(MAC_COMMAND_ERROR);
  }
  const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
  const protocols = web.startsWith("http:") ? "=http,https" : "=https";
  return `(set -o pipefail; curl -q --fail --silent --show-error --location --max-redirs 0 --proto ${quote(protocols)} --connect-timeout 20 --max-time 60 ${quote(`${web}/tracker/mac.sh`)} | VIBEHUB_API_URL=${quote(api)} VIBEHUB_WEB_URL=${quote(web)} bash)`;
}

/* ---- Copy ----
 *
 * Deliberately NOT reusing `INSTALL_START_MEANS`, `BACKGROUND_START_MEANS` or
 * `PRIVATE_COMMAND_NOTICE` from `connectPrompt.ts`: all three are true of the shell
 * connector and false of the app. The connector starts tracking as it installs, never
 * autostarts, and carries a key; the app installs without tracking anything, does resume
 * at login once started, and carries no key. The shared source/upload/visibility
 * disclosures are reused unchanged, so there is still one place to edit them.
 */

export const MAC_APP_SCOPE = "VibeHub for Mac carries the tracker. No Terminal setup.";
export const MAC_INSTALL_MEANS = "Installs to Applications and opens. Nothing is tracked yet.";
export const MAC_TOKENLESS_NOTICE = "The download and the command carry no device key.";
/** Releases before 1.1.0 have no browser pairing: the app asks for a pasted key. */
export const MAC_TOKEN_MEANS = "VibeHub asks for a device key on first launch. Create one below and paste it into the app.";
/** 1.1.0+: the app pairs through the browser, so there is nothing to create or paste here. */
export const MAC_PAIRING_MEANS = "On first launch VibeHub connects through your browser — you approve it there.";

/* Manual key issuance, explicitly authorised for this panel. It is a button, never a
 * side effect of choosing the macOS tab, and the key it returns is held in component
 * state only — no localStorage, no sessionStorage, and no reuse of the browser's stored
 * `vh-connect-token:<userId>` entry, which stays with the Windows/Linux flow. */
export const MAC_KEY_TITLE = "Device key for the app";
export const MAC_KEY_ACTION = "Create a device key";
export const MAC_KEY_RETRY = "Create another key";
export const MAC_KEY_PENDING = "Creating…";
export const MAC_KEY_ONCE = "Shown once, here. It is not saved in this browser — create another if you lose it.";
export const MAC_KEY_PRIVATE = "Private: it reports as you. Paste it into VibeHub, not into a terminal or a chat.";
export const MAC_KEY_ERROR = "Could not create a device key. Try again.";
export const MAC_AUTOSTART_MEANS = "Once you start tracking in the app, it resumes at login. Off stays off.";
export const MAC_COMMAND_MEANS = "Or paste this in Terminal — same installer.";
export const MAC_CHECKSUM_MISSING = "This release publishes no checksum. The command verifies one and stops without it — use the download.";
export const MAC_NOT_RELEASED = "VibeHub for Mac is not released yet.";
export const MAC_NOT_RELEASED_FIX = "Connect this Mac with the Terminal setup instead.";
export const MAC_UNAVAILABLE = "Could not check for a Mac release.";
export const MAC_REQUIREMENTS = "macOS 13 or later, Apple Silicon or Intel.";
