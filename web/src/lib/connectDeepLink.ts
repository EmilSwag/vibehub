// `/?connect=1` — the macOS menu-bar app's "Go online" button lands here.
//
// The param has to be read before anything else runs: the router rewrites the URL, and
// `ProtectedRoute` bounces a logged-out visitor to /login without carrying the query.
// So `captureConnectDeepLink()` runs from main.tsx before render, moves the intent into
// sessionStorage and strips the param from the address bar. HomePage takes it later.
//
// sessionStorage rather than a route param because the signed-out path is a round trip
// through GitHub and back via `?oauth=`: same tab, same origin, so the flag survives it,
// and LoginPage already lands on `/` afterwards. Nothing in the login or claim code has
// to know about any of this.

const KEY = "vh-connect-deeplink";

function session(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/**
 * Reads `?connect=1`, remembers it, and removes it from the URL. Call once, before
 * render. Safe to call when the param is absent.
 */
export function captureConnectDeepLink(): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (params.get("connect") !== "1") return;

  try {
    session()?.setItem(KEY, "1");
  } catch {
    // Private mode: the flag is lost, and the sheet simply does not open. Strip the
    // param anyway — a URL that keeps re-triggering nothing is worse than one that
    // triggered nothing once.
  }

  params.delete("connect");
  const query = params.toString();
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
  );
}

/** True once per capture. Clearing on read is what stops the sheet reopening on every
 *  later visit to Home in the same tab. */
export function takeConnectDeepLink(): boolean {
  const store = session();
  if (!store) return false;
  try {
    if (store.getItem(KEY) !== "1") return false;
    store.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}
