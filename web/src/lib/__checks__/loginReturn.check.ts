// Contract pin for lib/loginReturn.ts's open-redirect guard — plain assertions, no
// test framework, same pattern as topTool.check.ts / format.check.ts. Run from web/:
//   node --import tsx src/lib/__checks__/loginReturn.check.ts
// Exits non-zero (uncaught Error) when any expectation fails.
//
// Only `isSafeLocalPath` is exercised here: `rememberLoginReturn`/`takeLoginReturn`
// read `window.sessionStorage`, which a plain Node process (no DOM) doesn't have —
// same reason `connectDeepLink.ts`'s equivalent pair has no check file of its own.
// The security-relevant surface is entirely in the path validation, which is pure.

import { isSafeLocalPath, protectedRouteDecision } from "../loginReturn";

let passed = 0;
const failures: string[] = [];

function eq<T>(label: string, actual: T, expected: T): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed += 1;
    console.log(`ok   ${label} → ${a}`);
  } else {
    failures.push(label);
    console.log(`FAIL ${label}\n     expected ${e}\n     actual   ${a}`);
  }
}

// ---- accepted: same-origin app paths, exactly what a guest CTA or a login
// return would ever legitimately store ----

eq("plain profile path", isSafeLocalPath("/u/ada"), true);
eq("plain project path", isSafeLocalPath("/p/abc123"), true);
eq("root", isSafeLocalPath("/"), true);
eq("path with query string", isSafeLocalPath("/settings?tab=tracker"), true);
eq("path with hash", isSafeLocalPath("/u/ada#wall"), true);
eq("path with query and hash", isSafeLocalPath("/p/abc?ref=home#top"), true);

// ---- rejected: every shape that could turn a stored "return to" value into an
// off-VibeHub redirect ----

eq("protocol-relative (//)", isSafeLocalPath("//evil.com"), false);
eq("protocol-relative, deeper (///)", isSafeLocalPath("///evil.com"), false);
eq("backslash trick (browsers fold /\\ toward //)", isSafeLocalPath("/\\evil.com"), false);
eq("absolute https URL", isSafeLocalPath("https://evil.com/u/ada"), false);
eq("absolute http URL", isSafeLocalPath("http://evil.com"), false);
eq("javascript: URL", isSafeLocalPath("javascript:alert(1)"), false);
eq("mailto:", isSafeLocalPath("mailto:a@b.com"), false);
eq("scheme smuggled after a leading slash", isSafeLocalPath("/http://evil.com"), false);
eq("scheme smuggled after a leading slash (https)", isSafeLocalPath("/https://evil.com"), false);
eq("no leading slash at all", isSafeLocalPath("evil.com"), false);
eq("empty string", isSafeLocalPath(""), false);
eq("bare relative path (no leading slash)", isSafeLocalPath("u/ada"), false);

// ---- ProtectedRoute decisions: a /pair?code=… link must survive sign-in and a
// half-finished onboarding (the "I connect and nothing happens" bug) ----

const route = (signedIn: boolean, onboarded: boolean, pathname: string, search = "", bare = false) =>
  protectedRouteDecision({ signedIn, onboarded, pathname, search, bare });

eq("signed out on /pair?code → login, remembers the code", route(false, false, "/pair", "?code=VIBE-AB12"),
  { to: "login", remember: "/pair?code=VIBE-AB12" });
eq("signed out on /settings?tab=x → login, remembers it", route(false, false, "/settings", "?tab=x"),
  { to: "login", remember: "/settings?tab=x" });
eq("signed out on / → login, nothing to remember", route(false, false, "/"), { to: "login", remember: null });
eq("signed out on /login → login, never remembers itself", route(false, false, "/login"), { to: "login", remember: null });
eq("signed out, protocol-relative path → not remembered", route(false, false, "//evil.com"), { to: "login", remember: null });
eq("new user on /pair?code → renders bare (no onboarding bounce)", route(true, false, "/pair", "?code=VIBE-AB12"),
  { to: "render", bare: true });
eq("new user on /pair/ subpath → renders bare", route(true, false, "/pair/x"), { to: "render", bare: true });
eq("new user on /pairing (not /pair) → onboarding", route(true, false, "/pairing"), { to: "onboarding" });
eq("new user on / → onboarding", route(true, false, "/"), { to: "onboarding" });
eq("new user on /settings → onboarding", route(true, false, "/settings"), { to: "onboarding" });
eq("new user on /onboarding (bare route) → renders bare", route(true, false, "/onboarding", "", true),
  { to: "render", bare: true });
eq("onboarded user on /onboarding → home", route(true, true, "/onboarding"), { to: "home" });
eq("onboarded user on /pair → renders in the app shell", route(true, true, "/pair", "?code=VIBE-AB12"),
  { to: "render", bare: false });
eq("onboarded user on /friends → renders", route(true, true, "/friends"), { to: "render", bare: false });

// ---- summary ----
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  throw new Error(`loginReturn.check: ${failures.length} assertion(s) failed:\n  - ${failures.join("\n  - ")}`);
}
