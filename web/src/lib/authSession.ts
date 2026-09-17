// One synchronous boundary for HTTP, sockets and account-owned async work.
// A response may only affect the generation that started it. No credentials live here.
type BoundaryReason = "authenticated" | "expired";
type Listener = (reason: BoundaryReason) => void;
let generation = 0;
let expired = false;
const listeners = new Set<Listener>();

export class AuthSessionChangedError extends Error {
  constructor() {
    super("The signed-in session changed. Please try again.");
    this.name = "AuthSessionChangedError";
  }
}

export const authGeneration = (): number => generation;
export const isCurrentAuth = (expected: number): boolean => expected === generation && !expired;

/** Also check after parsing a body: a newer login can finish during res.json(). */
export function assertAuthGeneration(expected: number): void {
  if (!isCurrentAuth(expected)) throw new AuthSessionChangedError();
}

/** Cookie-writing requests must finish in order. Ignoring an old response in React
 * cannot undo its Set-Cookie header. Failed requests must not poison the queue. */
export function createAuthQueue() {
  let tail: Promise<void> = Promise.resolve();
  return <T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(work);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}

export function onAuthBoundary(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function clearPrivateCaches(): void {
  // Keep device preferences and non-sensitive per-user seen/celebrated flags.
  // Never clear all storage: it may belong to another feature on this origin.
  for (const [kind, prefix] of [
    ["localStorage", "vh-connect-token:"],
    ["sessionStorage", "vh.onboarding.step:"],
  ] as const) {
    try {
      const store = window[kind];
      const keys = Array.from({ length: store.length }, (_, i) => store.key(i));
      keys.forEach((key) => { if (key?.startsWith(prefix)) store.removeItem(key); });
    } catch {
      // Private/sandboxed storage must not prevent sign-out.
    }
  }
}

/** A successful login (even to the same account) invalidates all older responses. */
export function beginAuthenticatedSession(): number {
  generation += 1;
  expired = false;
  clearPrivateCaches();
  listeners.forEach((listener) => listener("authenticated"));
  return generation;
}

/** Dedupe concurrent 401s; an old response cannot expire a newer login. */
export function expireAuthSession(expected: number): boolean {
  if (!isCurrentAuth(expected)) return false;
  generation += 1;
  expired = true;
  clearPrivateCaches();
  listeners.forEach((listener) => listener("expired"));
  return true;
}
