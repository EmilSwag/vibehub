import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { API_BASE, macApi, usersApi } from "../lib/api";
import {
  TRACKER_CONTROL_NOTICE,
  TRACKER_HISTORY_NOTICE,
  TRACKER_LOCAL_READS,
  TRACKER_STATE_NOTICE,
  TRACKER_SUPPORT_DETAILS,
  TRACKER_SUPPORT_NOTICE,
  TRACKER_UPLOADS,
  TRACKER_VISIBILITY,
} from "../lib/connectPrompt";
import {
  MAC_APP_SCOPE,
  MAC_AUTOSTART_MEANS,
  MAC_CHECKSUM_MISSING,
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
  MAC_PAIRING_MEANS,
  MAC_REQUIREMENTS,
  MAC_TOKEN_MEANS,
  MAC_TOKENLESS_NOTICE,
  MAC_UNAVAILABLE,
  buildMacInstallCommand,
  isVersionAtLeast,
  macReleaseState,
  macReleaseStateFromError,
} from "../lib/macInstall";
import type { MacReleaseState } from "../lib/macInstall";
// `deviceLabel` only — a pure date/OS formatter, so a key minted here is named exactly
// like one minted anywhere else. None of that module's storage helpers are imported:
// this panel must never read, write or extend `vh-connect-token:<userId>`.
import { deviceLabel } from "../lib/connectToken";
import { formatShortDate } from "../lib/format";
import { Button } from "./ui/Button";
import { Skeleton } from "./ui/Skeleton";
import styles from "./MacInstall.module.css";

const WEB_URL = window.location.origin;
const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");
type Copyable = "command" | "key";

/**
 * The macOS tab of the tracker install picker — VibeHub.app instead of a shell script.
 *
 * INSTALL IS TOKENLESS (plan FC4). Both entrances — the `.pkg` download and the one
 * `curl … | bash` line — carry no device key: not in the URL, not in argv, not in the
 * environment, and there is no `vibehub://connect?token=` deep link. The app asks for a
 * key in its own onboarding.
 *
 * ISSUING A KEY IS MANUAL AND EXPLICIT. Because the app asks for one, this panel can
 * hand the user a key to paste — otherwise the instruction would point back at the page
 * it is printed on. That issuance is a button press and nothing else:
 *   - choosing the macOS tab mints nothing; mounting this component only reads the
 *     release endpoint,
 *   - the key lives in component state and is never written to `localStorage`,
 *     `sessionStorage` or `connectToken.ts`'s stored entry, which stays with the
 *     untouched Windows/Linux flow,
 *   - the parents remount on a user change (`key={user?.id ?? "signed-out"}`), so a key
 *     can never outlive the account it belongs to.
 * A caller that has *already* minted a key without caching it (Settings' Add device)
 * passes it as `token`, so that path shows that key instead of minting a second one.
 *
 * RELEASE STATE IS TRUTHFUL (FC3): a shape-matched skeleton while loading, "not released
 * yet" only on 404, "could not check" with a retry on anything else, and — when a
 * release published no checksum — a working download beside a command that is explicitly
 * withheld, because `mac.sh` aborts on a null checksum rather than installing unverified.
 */
export function MacInstall({ token, className }: { token?: string; className?: string }) {
  const id = useId();
  const [state, setState] = useState<MacReleaseState>({ kind: "loading" });
  const [retry, setRetry] = useState(0);
  const [issued, setIssued] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [copied, setCopied] = useState<Copyable | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const generation = useRef(0);
  const issueGeneration = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const mine = ++generation.current;
    setState({ kind: "loading" });
    macApi
      .latest(controller.signal)
      .then((raw) => { if (mine === generation.current) setState(macReleaseState(raw)); })
      .catch((error: unknown) => {
        // An aborted request is a remount, not an answer about the release.
        if (mine !== generation.current || controller.signal.aborted) return;
        setState(macReleaseStateFromError(error));
      });
    return () => { controller.abort(); };
  }, [retry]);

  useEffect(() => () => { generation.current += 1; issueGeneration.current += 1; }, []);

  const command = useMemo(() => {
    try {
      return { text: buildMacInstallCommand(API_BASE, WEB_URL), error: null };
    } catch (error) {
      return { text: null, error: error instanceof Error ? error.message : MAC_UNAVAILABLE };
    }
  }, []);

  // The only mint in this file, and it is reachable only from the button below.
  const issueDeviceKey = useCallback(async () => {
    const mine = ++issueGeneration.current;
    setIssuing(true);
    setIssueError(null);
    setCopied(null);
    try {
      const result = await usersApi.createTrackerToken(deviceLabel("mac"));
      if (mine !== issueGeneration.current) return;
      setIssued(result.token);
    } catch {
      if (mine === issueGeneration.current) setIssueError(MAC_KEY_ERROR);
    } finally {
      if (mine === issueGeneration.current) setIssuing(false);
    }
  }, []);

  const copy = useCallback(async (what: Copyable, text: string) => {
    setCopied(null);
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setCopyError("Copy failed — select and copy the text above.");
    }
  }, []);

  // A key is only useful once an app exists to paste it into. "Not released yet" is the
  // one answer that makes the whole block pointless; "could not check" is not.
  const key = token ?? issued;
  const canInstall = state.kind === "ready" || state.kind === "unavailable";
  // 1.1.0+ pairs through the browser; anything older (or unknown) needs a pasted key.
  const pairs = state.kind === "ready" && isVersionAtLeast(state.release.version, "1.1.0");
  const showsKey = canInstall && !pairs;

  return (
    <div className={cx(styles.mac, className, "fade-in")}>
      <p className={styles.lead}>{MAC_APP_SCOPE}</p>

      {/* Load-bearing before either entrance: what installing does, and that tracking
          resumes at login once started. The rest of the data story sits one click away
          in the disclosure at the bottom, so the download reads in a glance. */}
      <p className={styles.consent} aria-label="Before you install">
        {MAC_INSTALL_MEANS} {MAC_AUTOSTART_MEANS}
      </p>

      {state.kind === "loading" && (
        // Same silhouette as the ready state: download button, meta line, command, copy.
        <div className={styles.release} aria-busy="true" aria-label="Checking for a Mac release">
          <Skeleton variant="pill" height={44} width="100%" />
          <Skeleton height={12} width="62%" />
          <Skeleton variant="block" height={76} width="100%" />
          <Skeleton variant="pill" height={44} width="100%" />
        </div>
      )}

      {state.kind === "none" && (
        <div className={styles.release}>
          <p className={styles.state}>{MAC_NOT_RELEASED}</p>
          <p className={styles.sub}>{MAC_NOT_RELEASED_FIX}</p>
        </div>
      )}

      {state.kind === "unavailable" && (
        <div className={styles.release}>
          <p className={styles.state} role="alert">{MAC_UNAVAILABLE}</p>
          <Button variant="secondary" className={styles.action} onClick={() => setRetry((value) => value + 1)}>
            Check again
          </Button>
        </div>
      )}

      {state.kind === "ready" && (
        <div className={styles.release}>
          <a
            className={styles.download}
            href={state.release.pkgUrl}
            rel="noopener noreferrer"
            download
          >
            Download VibeHub for Mac
          </a>
          <p className={styles.meta}>
            {[
              `Version ${state.release.version}`,
              state.release.publishedAt && formatShortDate(state.release.publishedAt),
              MAC_REQUIREMENTS,
            ].filter(Boolean).join(" · ")}
          </p>

          {state.commandUsable ? (
            command.text ? (
              <>
                <p className={styles.sub}>{MAC_COMMAND_MEANS}</p>
                <pre className={styles.cmd} tabIndex={0} aria-label="Mac install command">{command.text}</pre>
                <Button variant="secondary" className={styles.action} onClick={() => void copy("command", command.text!)}>
                  {copied === "command" ? "Command copied" : "Copy install command"}
                </Button>
              </>
            ) : (
              <p className={styles.state} role="alert">{command.error}</p>
            )
          ) : (
            <p className={styles.sub}>{MAC_CHECKSUM_MISSING}</p>
          )}
        </div>
      )}

      {canInstall && (
        <div className={styles.keyBlock}>
          {pairs ? (
            <div className={styles.next}>
              <p className={styles.lead}>Then</p>
              <ol className={styles.steps}>
                <li>Open VibeHub from Applications.</li>
                <li>Click <strong>Connect in Browser</strong>. No keys to copy.</li>
              </ol>
              <p className={styles.hint}>Blocked on first launch? System Settings → Privacy &amp; Security → Open Anyway.</p>
            </div>
          ) : (
            <div className={styles.next}>
              <p className={styles.lead}>Then</p>
              <ol className={styles.steps}>
                <li>Open VibeHub from Applications.</li>
                <li>Paste the device key below, then press Start.</li>
              </ol>
              <p className={styles.hint}>Blocked on first launch? System Settings → Privacy &amp; Security → Open Anyway.</p>

              <h4 className={styles.keyTitle}>{MAC_KEY_TITLE}</h4>
              {key ? (
                <>
                  <p className={styles.sub}>{MAC_KEY_ONCE}</p>
                  <p className={styles.sub}>{MAC_KEY_PRIVATE}</p>
                  <pre className={styles.token} tabIndex={0} aria-label="Device key">{key}</pre>
                  <Button variant="secondary" className={styles.action} onClick={() => void copy("key", key)}>
                    {copied === "key" ? "Key copied" : "Copy device key"}
                  </Button>
                </>
              ) : (
                <Button
                  variant="secondary"
                  className={styles.action}
                  disabled={issuing}
                  onClick={() => void issueDeviceKey()}
                >
                  {issuing ? MAC_KEY_PENDING : issueError ? MAC_KEY_RETRY : MAC_KEY_ACTION}
                </Button>
              )}
              {issueError && <p className={styles.state} role="alert">{issueError}</p>}
            </div>
          )}
        </div>
      )}

      {copyError && <p className={styles.state} role="alert">{copyError}</p>}

      <button
        type="button"
        className={styles.link}
        aria-expanded={detailsOpen}
        aria-controls={`${id}-mac-data`}
        onClick={() => setDetailsOpen((value) => !value)}
      >
        What it reads and sends
      </button>
      {detailsOpen && (
        <div id={`${id}-mac-data`} className={cx(styles.details, "fade-in")}>
          <p className={styles.sub}>
            {MAC_TOKENLESS_NOTICE}{" "}
            {/* Mirrors the steps: only point at "below" when the key block is really there. */}
            {showsKey ? MAC_TOKEN_MEANS : MAC_PAIRING_MEANS}
          </p>
          <p className={styles.sub}>{TRACKER_LOCAL_READS}</p>
          <p className={styles.sub}>{TRACKER_UPLOADS} {TRACKER_VISIBILITY}</p>
          <p className={styles.sub}>{TRACKER_SUPPORT_NOTICE} {TRACKER_SUPPORT_DETAILS}</p>
          <p className={styles.sub}>{TRACKER_STATE_NOTICE}</p>
          <p className={styles.sub}>{TRACKER_CONTROL_NOTICE} {TRACKER_HISTORY_NOTICE}</p>
        </div>
      )}
    </div>
  );
}
