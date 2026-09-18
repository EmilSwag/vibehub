// TopBar's guest "Continue with GitHub" action (public /u/:username, /p/:id) sends a
// signed-out visitor through the real GitHub OAuth round trip — an external domain
// and a full page reload, same shape as `connectDeepLink.ts`'s deep link. So the
// return destination is remembered in sessionStorage, not React/router state: it has
// to survive leaving the origin entirely and coming back via the server's redirect
// to `/login?oauth=...`. LoginPage takes it once sign-in actually completes.

const KEY = "vh-login-return";

function session(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/** Same-origin app path only — never an absolute URL or a scheme, so a stored value
 *  can't turn a login redirect into an open redirect off VibeHub. Exported only so
 *  loginReturn.check.ts can pin the accept/reject contract directly — everything
 *  else here touches `window.sessionStorage`, which a plain Node check can't. */
export function isSafeLocalPath(path: string): boolean {
  return (
    path.startsWith("/") &&
    !path.startsWith("//") &&
    !path.startsWith("/\\") &&
    !/^\/[a-z][a-z0-9+.-]*:/i.test(path)
  );
}

/** Call right before navigating a guest away to GitHub. Silently drops anything that
 *  isn't a safe local path — an unsafe or empty value just means login lands on "/". */
export function rememberLoginReturn(path: string): void {
  if (!isSafeLocalPath(path)) return;
  try {
    session()?.setItem(KEY, path);
  } catch {
    // Private mode: the flag is lost, and login falls back to "/" — same graceful
    // degradation as captureConnectDeepLink.
  }
}

// Resolved once per page load, then cached here — not in sessionStorage, which is
// already cleared after the first real read, and not in component state, which
// AuthContext.tsx's post-login remount (the generation-keyed <Fragment>, unrelated
// to and unchanged by this fix) discards along with the rest of the app tree at
// the exact moment `completeOAuth`/`devLogin` succeeds. A resolved `null` is still
// cached — the resolution itself (no stored value, or an unsafe one) doesn't need
// redoing either. `undefined` is "not resolved yet"; every other value is final.
let cached: string | null | undefined;

/** True once per remember, no matter how many times this is called: the first
 *  call resolves and caches the answer for the rest of this page load, so a
 *  React StrictMode double-invoke or a later remount of the caller both get the
 *  same answer instead of the second one finding sessionStorage already empty. */
export function takeLoginReturn(): string | null {
  if (cached !== undefined) return cached;
  const store = session();
  if (!store) return (cached = null);
  try {
    const path = store.getItem(KEY);
    store.removeItem(KEY);
    return (cached = path !== null && isSafeLocalPath(path) ? path : null);
  } catch {
    return (cached = null);
  }
}
