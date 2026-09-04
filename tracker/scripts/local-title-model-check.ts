import { isRealWindowTitle, projectFromTitle } from "../src/adapters/processes";

// Local-only proof for Round 5 Phase 9: the window-title leak fix (raw OS window
// class names like OleMainThreadWndName must never become a project) and that a real
// title still resolves its project. Pure functions, no OS calls.
//
//   npx tsx scripts/local-title-model-check.ts

let pass = true;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = got === want;
  pass = pass && ok;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label} — got ${JSON.stringify(got)}${ok ? "" : ` want ${JSON.stringify(want)}`}`);
};

// Junk OS window titles → not real, and never a project.
for (const junk of [
  "OleMainThreadWndName",
  "OleDdeWndName",
  "Default IME",
  "MSCTFIME UI",
  "DDE Server Window",
  "GDI+ Window",
  ".NET-BroadcastEventWindow.2.b7ab8f.1.0",
  "CicMarshalWnd",
  "MediaContextNotificationWindow",
  "Chrome_WidgetWin_1",
  "N/A",
  "",
]) {
  eq(`isRealWindowTitle(${JSON.stringify(junk)})`, isRealWindowTitle(junk), false);
  eq(`projectFromTitle(${JSON.stringify(junk)}) -> null`, projectFromTitle(junk, ["cursor"]), null);
}

// Real titles → real, and resolve their project.
eq("cursor real title is real", isRealWindowTitle("● index.ts - vibehub - Cursor"), true);
eq("cursor '<file> - <project> - Cursor' -> project", projectFromTitle("● index.ts - vibehub - Cursor", ["cursor"]), "vibehub");
eq("cursor '<project> - Cursor' -> project", projectFromTitle("myrepo - Cursor", ["cursor"]), "myrepo");
eq("vscode strips its suffix", projectFromTitle("app.ts - deephold - Visual Studio Code", ["visual studio code"]), "deephold");
eq("quadcode bare app name -> null (no project)", projectFromTitle("Quadcode AI", ["quadcode ai"]), null);
eq("grok bare app name -> null", projectFromTitle("Grok", ["grok"]), null);

console.log(pass ? "\nALL PASS" : "\nFAILURES ABOVE");
if (!pass) process.exitCode = 1;
