// Contract pins for lib/connectPrompt.ts — plain assertions, no test framework.
// Run from the repo root:  npx tsx web/src/lib/__checks__/connectPrompt.check.ts
// Exits non-zero (uncaught Error) when any expectation fails. Deliberately free of
// node-only imports so it also type-checks under web/tsconfig.json (DOM lib only).
//
// These are safety pins, not style pins. A Claude Code auto-mode classifier refused
// the round-8C prompt because one paste installed the tracker *and* spawned a
// background daemon. The rules below are what stops that regressing:
//
//   1. Installing and starting are separate, in that order, with a question between.
//   2. Nothing after install carries the device token.
//   3. A blocked start ends the automation — no bypass, no retry, no permission edits.
//   4. The Windows commands are actually runnable on Windows.

import {
  BACKGROUND_START_MEANS,
  buildConnectPrompt,
  buildInstallCommand,
  buildStartCommand,
  buildStatusCommand,
  buildStopCommand,
  buildTrackerCommand,
  buildVerifyLine,
} from "../connectPrompt";
import type { ConnectPromptTarget, InstallOs, TrackerVerb } from "../connectPrompt";

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

const TOKEN = "vhq-SECRET-TOKEN-do-not-leak-0123456789";
const API = "https://api.example.test";
const WEB = "https://web.example.test";

const OSES: InstallOs[] = ["mac", "windows"];
const VERBS: TrackerVerb[] = ["start", "status", "stop"];
const AGENTIC: ConnectPromptTarget[] = ["cursor", "claude-code", "codex", "quadcode"];
const ALL: ConnectPromptTarget[] = [...AGENTIC, "chatgpt"];

const promptFor = (t: ConnectPromptTarget) => buildConnectPrompt(t, TOKEN, API, WEB);

// ---- 2. the token lives in exactly one place ----

eq(
  "no tracker verb carries the token, on either OS",
  OSES.flatMap((os) => VERBS.map((v) => buildTrackerCommand(os, v).includes(TOKEN))),
  [false, false, false, false, false, false]
);

// Not vacuous: the install command is the one thing that legitimately carries it.
eq(
  "the install command does carry the token",
  OSES.map((os) => buildInstallCommand(os, TOKEN, API, WEB).includes(TOKEN)),
  [true, true]
);

eq(
  "the verify line carries no token either",
  OSES.map((os) => buildVerifyLine(os).includes(TOKEN)),
  [false, false]
);

// The whole prompt may mention the token only inside the two install one-liners.
for (const target of ALL) {
  const text = promptFor(target);
  const occurrences = text.split(TOKEN).length - 1;
  eq(`${target}: the token appears exactly twice (the two install one-liners)`, occurrences, 2);
}

// ---- 4. the Windows commands are runnable on Windows ----
//
// `node` never expands `~` itself. The old single POSIX status line was handed to
// Windows users too, where node received a literal "~" and failed on a path that does
// not exist. PowerShell expands $HOME before node is called.
eq(
  "windows tracker commands never contain a bare ~",
  VERBS.map((v) => buildTrackerCommand("windows", v).includes("~")),
  [false, false, false]
);
// These three literals are the drift pin against Cody's installers, which print the
// same commands from their own shell variables (install.sh: APP_DIR="$HOME/.vibehub/app";
// install.ps1: Join-Path $HOME ".vibehub\app"). If either side is edited alone, this
// is what should go red — the two cannot share a source, so they are checked instead.
eq(
  "windows tracker commands expand $HOME and quote the path",
  buildStartCommand("windows"),
  'node "$HOME\\.vibehub\\app\\vibehub-tracker.cjs" start'
);
eq(
  "posix tracker commands expand $HOME and quote the path",
  buildStatusCommand("mac"),
  'node "$HOME/.vibehub/app/vibehub-tracker.cjs" status'
);
eq("stop is the same shape", buildStopCommand("mac"), 'node "$HOME/.vibehub/app/vibehub-tracker.cjs" stop');

// Quoted, and expanded. A bare `~` word-splits on a home directory with a space in
// it, and `"~/..."` would not expand at all.
eq(
  "no tracker command uses a bare ~, on either OS",
  OSES.flatMap((os) => VERBS.map((v) => buildTrackerCommand(os, v).includes("~"))),
  [false, false, false, false, false, false]
);
eq(
  "every tracker command quotes its path",
  OSES.flatMap((os) => VERBS.map((v) => /node "\$HOME[^"]+" (start|status|stop)$/.test(buildTrackerCommand(os, v)))),
  [true, true, true, true, true, true]
);
eq(
  "the verify line quotes the OS-correct status command",
  OSES.map((os) => buildVerifyLine(os).includes(buildStatusCommand(os))),
  [true, true]
);

// ---- every target carries both OSes, for install and for start ----
//
// The prompt is emitted once and the agent picks the branch, so "works on Windows"
// means the Windows line is actually in the text — for all five targets.
for (const target of ALL) {
  const text = promptFor(target);
  eq(
    `${target}: both OS install commands are present`,
    OSES.map((os) => text.includes(buildInstallCommand(os, TOKEN, API, WEB))),
    [true, true]
  );
  eq(
    `${target}: both OS start commands are present`,
    OSES.map((os) => text.includes(buildStartCommand(os))),
    [true, true]
  );
  eq(
    `${target}: both OS verify lines are present`,
    OSES.map((os) => text.includes(buildVerifyLine(os))),
    [true, true]
  );
}

// ---- the text diet stays on (round 9, job 1A) ----
//
// Measured the way the brief specifies: the prompt with both install one-liners
// removed, since those are as long as the deployment URL and token make them.
//
// A ratchet against regrowth, not a target that was tuned to: the prompt lands at
// 1597 with the mandated wording. Raising this bound should take the same argument
// the diet did.
const AGENTIC_PROMPT_MAX = 1700;
eq(
  `every agentic prompt stays under ${AGENTIC_PROMPT_MAX} chars, excluding the install commands`,
  AGENTIC.map((t) => {
    const bare = promptFor(t)
      .split(buildInstallCommand("mac", TOKEN, API, WEB))
      .join("")
      .split(buildInstallCommand("windows", TOKEN, API, WEB))
      .join("");
    return bare.length < AGENTIC_PROMPT_MAX;
  }),
  [true, true, true, true]
);

// ---- 1. install, then ask, then start — in that order ----

for (const target of ALL) {
  const text = promptFor(target);
  const install = text.indexOf(buildInstallCommand("mac", TOKEN, API, WEB));
  const ask = text.indexOf(BACKGROUND_START_MEANS);
  const start = text.indexOf(buildStartCommand("mac"));
  eq(`${target}: install, then the explanation, then the start command`, [install < ask, ask < start], [true, true]);
  eq(`${target}: every one of the three is present`, [install, ask, start].every((i) => i >= 0), true);
}

eq(
  "the setup step says plainly that it starts no background tracker",
  ALL.map((t) => /starts no background tracker and adds no OS autostart/.test(promptFor(t))),
  [true, true, true, true, true]
);

eq(
  "the agent is told to wait for an answer rather than infer consent",
  ALL.map((t) => /Wait for my answer/.test(promptFor(t))),
  [true, true, true, true, true]
);

eq(
  "a successful install is explicitly not permission to start",
  ALL.map((t) => /a successful install is not permission to start\./.test(promptFor(t))),
  [true, true, true, true, true]
);

// ---- 3. a blocked start ends the automation ----

eq(
  "agentic prompts carry the blocked-step clause",
  AGENTIC.map((t) => /If your safety rules or approval prompts block step 2 or step 5, stop automating/.test(promptFor(t))),
  [true, true, true, true]
);

// A blocked *install* has to end the automation too, not just a blocked start — and
// it must point back at step 2's command rather than printing the token a third time.
// One paragraph now covers both blocked steps and reprints no command (round 9, job
// 1A amendment) — so these pin phrases of that paragraph rather than two branches.
eq(
  "a blocked step hands its own command to the user's terminal",
  AGENTIC.map((t) => /stop automating: say so and show me that step's command to run in my own terminal\./.test(promptFor(t))),
  [true, true, true, true]
);
eq(
  "both the install step and the start step are named as blockable",
  AGENTIC.map((t) => /block step 2 or step 5/.test(promptFor(t))),
  [true, true, true, true]
);

eq(
  "the clause reprints no command — it points back at the step",
  AGENTIC.map((t) => (promptFor(t).match(/in my own terminal/g) ?? []).length),
  [1, 1, 1, 1]
);

eq(
  "a blocked step is named a normal outcome, not an obstacle",
  AGENTIC.map((t) => /A blocked step is a normal outcome, not a problem to solve\./.test(promptFor(t))),
  [true, true, true, true]
);

eq(
  "no retrying around the refusal",
  AGENTIC.map((t) => /Do not retry with other flags, shells or wrapper scripts/.test(promptFor(t))),
  [true, true, true, true]
);

eq(
  "no touching permission, allow-list or settings files",
  AGENTIC.map((t) => /do not edit any permission, allow-list or settings file/.test(promptFor(t))),
  [true, true, true, true]
);

// No prompt may ever suggest a way around a safety control. This list is the point of
// the file: if a future edit reintroduces any of it, the build should stop.
const BYPASS = [
  "--dangerously-skip-permissions",
  "--dangerously",
  "--no-verify",
  "bypass",
  "allowlist",
  "allow-list it",
  "whitelist",
  "sudo",
  "chmod +x",
  "disable the safety",
  "settings.local.json",
  "ignore the warning",
  "approve it automatically",
  "auto-approve",
];
for (const target of ALL) {
  const lower = promptFor(target).toLowerCase();
  const found = BYPASS.filter((phrase) => lower.includes(phrase.toLowerCase()));
  eq(`${target}: no bypass vocabulary`, found, []);
}

// ---- the non-agentic branch still asks ----

eq(
  "chatgpt is walked through it and is never told to run anything itself",
  /You can't run commands/.test(promptFor("chatgpt")),
  true
);

eq(
  "chatgpt is asked for approval before being handed the start line",
  promptFor("chatgpt").indexOf("whether to start the tracker") <
    promptFor("chatgpt").indexOf(buildStartCommand("mac")),
  true
);

// ---- the consent sentence is one sentence, used verbatim in both places ----

// The consent sentence has to describe what the tracker actually does. It used to
// claim "It reads no file contents", which is false: the Claude Code, Codex and
// Quadcode adapters tail session JSONL files. They extract only ids, the model and
// token counts — never message content — so the true statement is about what is
// *sent*, not about what is read.
eq(
  "the background-start explanation is accurate about reading, sending and autostart",
  [
    /Runs in the background until you stop it\./.test(BACKGROUND_START_MEANS),
    /Reads activity metadata and window titles/.test(BACKGROUND_START_MEANS),
    /tool, model, project name, timestamps and token counts/.test(BACKGROUND_START_MEANS),
    /never your code or prompts/.test(BACKGROUND_START_MEANS),
    /No OS autostart\./.test(BACKGROUND_START_MEANS),
  ],
  [true, true, true, true, true]
);

// Regression guard on the exact false claim that shipped.
eq(
  "it never again claims to read no file contents",
  [/reads no file contents/i.test(BACKGROUND_START_MEANS), ...ALL.map((t) => /reads no file contents/i.test(promptFor(t)))],
  [false, false, false, false, false, false]
);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) throw new Error(`connectPrompt check failed: ${failures.join(", ")}`);
