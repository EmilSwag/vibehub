# QA report — setup-only tracker installers (Cody)

Plans: `meta/plans/vibehub-tracker-explicit-start.md` step 2, and the review round `meta/plans/tracker-installer-review-fixes.md`.
Date: 2026-09-14. Scope: `web/public/tracker/install.{ps1,sh}` + their regression tests.
No commit, no push, no deploy. No real tracker was launched on this workstation.

## Files changed / created

| Path | State |
|------|-------|
| `vibehub/web/public/tracker/install.ps1` | modified — setup-only |
| `vibehub/web/public/tracker/install.sh` | modified — setup-only |
| `vibehub/web/scripts/test-installers.mjs` | **created** — 183-assertion regression suite |
| `vibehub/web/package.json` | modified — added `test:installers` script only |
| `meta/plans/vibehub-tracker-explicit-start.md` | updated — steps 1–2 closed with skill tags (shared file; Jace also writes here) |
| `meta/plans/tracker-installer-review-fixes.md` | **created** — the review round, Cody-only |
| `vibehub/web/reports/tracker-setup-only-installers-qa.md` | **created** — this report |

Not touched: `web/src` (Jace), `server/auth`, tracker daemon behaviour, `web/dist`.

## Installer semantics

Both scripts do exactly two things: **download the tracker**, then **validate and save the token**. They end there.

- Removed `node $BIN stop` and `node $BIN start` from both.
- No spawn, no detach, no OS autostart on any branch — no `nohup` / `&` / `disown` / `setsid` / `launchctl` / `systemctl` / `crontab` / LaunchAgents, and no `Start-Process` / `Start-Job` / `schtasks` / `Register-ScheduledTask` / HKCU Run key / Startup folder / hidden-window spawn / `WScript.Shell`.
- **No bypass.** No environment variable, flag or argument re-enables a background start. Both file headers state this explicitly so it is not "restored" later as a convenience.
- **Outcome copy claims only what the installer itself did:**
  `Installed. Start tracking separately when you're ready.` / `This installer did not start or stop a tracker.`
  Then token-free quoted `start` / `status` / `stop`, then `To apply a new token or build to an already-running tracker, stop it then start it yourself.`, then: `start` does not survive a reboot, and the Connect card flips only on server-confirmed activity.
  The earlier line `Nothing is being tracked yet` was removed as **false** — it is a claim about the machine, and it is wrong whenever a tracker was already running before the install.
- **Honest failures:** missing token; Node absent or < 18; non-2xx download; a 200 that is not the tracker (size sanity check, which runs *before* the token is sent anywhere); rejected token (`$LASTEXITCODE` check on Windows, `set -e` on POSIX).
- **A running daemon is left strictly alone** — no stop, no restart.
- Byte invariants preserved per `scripts/normalize-eol.mjs`: `install.ps1` UTF-8 **with BOM** + CRLF; `install.sh` BOM-less + **LF-only**. Re-verified after every edit and after both negative-control round-trips — confirmed figures in *Post-revert verification* below.
- Both parse clean: `[PSParser]::Tokenize` (PS 5.1) and `bash -n`.

## Test suite

`vibehub/web/scripts/test-installers.mjs` — run with `npm run test:installers`.

Safety design: the "tracker" downloaded during tests is a **stub** that records its own argv and spawns nothing. Installers run against a throwaway `HOME` and a localhost origin. Each run **aborts unless the sandboxed HOME demonstrably took effect**, so a developer's real `~/.vibehub` — and any tracker they actually have running — can never be touched. The suite is async on purpose: a blocking `spawnSync` deadlocks against the in-process stub server.

**No execution-policy bypass.** `install.ps1` is launched with `-NoProfile -File` only. A probe runs a throwaway `.ps1` first; if policy blocks script files, `install.ps1` is not run, a `BLOCKERS` section says what is unverified and what the operator would have to change themselves, and the verdict is `BLOCKED` with a non-zero exit. The probe keys on sentinel output, not exit code — verified against `-ExecutionPolicy Restricted`, where PowerShell refuses the file on stderr. On this machine the effective policy is `Bypass`, so `install.ps1` is genuinely verified here.

### Results — 183 assertions, PASS, 0 failed, 0 blockers

| Group | Assertions | Result |
|-------|-----------:|--------|
| Source pattern scan — `install.sh` | 16 | pass |
| Source pattern scan — `install.ps1` | 16 | pass |
| Preconditions (no-node PATHs, policy probe) | 3 | pass |
| `install.sh` happy path (+ printed commands run) | 19 | pass |
| `install.sh` HOME with a space (+ printed commands run) | 19 | pass |
| `install.sh` rejected token | 6 | pass |
| `install.sh` junk download (200, not the tracker) | 6 | pass |
| `install.sh` non-2xx download (503) | 5 | pass |
| `install.sh` node missing | 6 | pass |
| `install.sh` node older than 18 | 7 | pass |
| `install.sh` missing token | 6 | pass |
| `install.ps1` — the same eight cases | 74 | pass |
| **Total** | **183** | **PASS** |

**Source pattern scan (32).** Honest scope, stated in the source too: this is a **textual grep** over the two files with comments stripped. It is the only check that sees *every* branch at once, including branches the sandbox runs never enter, and it catches the constructs spelled out literally — which is how a "just start it for the user" convenience would realistically get reintroduced. It does **not** catch an indirect or obfuscated spawn (a command assembled from variables, `eval`/`iex` of a fetched string, a helper invoked by name); those are covered for the paths they touch by the sandbox runs, and outside those paths by review, not by this script. It asserts: never invokes `start`/`stop`/`run-loop`; none of the background/autostart constructs; the did-not-start-or-stop sentence is present; the false `Nothing is being tracked yet` is absent; the stop-then-start guidance is present; `start`/`status`/`stop` each quoted.

**Happy path (19 per shell)** asserts: exit 0; the only tracker invocation is `login`; never `start`/`stop`/`restart`/`run-loop`; `login` validates against the server (`--api-url`); tracker downloaded; a pre-seeded `tracker.pid` byte-identical afterwards; no daemon/autostart artifacts anywhere under HOME; the did-not-start-or-stop sentence present; no "nothing is being tracked" claim; stop-then-start guidance present; no "is running"/"Connected: yes"; token never echoed. Then **the printed commands are parsed back out of stdout and actually executed** through the matching shell against the stub, asserting the tracker receives exactly `["start"]`, `["status"]`, `["stop"]` and that none carries a token.

**HOME with a space (19 per shell)** repeats the whole happy path in a home directory whose name contains spaces. Together with the executed printed commands, this is what proves the printed quoting survives — previously those strings were only pattern-matched, never run.

**Failure cases** assert non-zero exit, no lifecycle command, no success block, running daemon untouched, and either "the token is never sent" or "login was attempted, nothing else". Node-missing runs with PATH stripped to a directory *verified in the preconditions* to contain no node; node-older-than-18 uses a shim printing `v16.20.0` and additionally asserts the `18+ is required` message. Download state is asserted where it is deterministic and deliberately not asserted for the 503 case, where curl and `Invoke-WebRequest` differ on whether a zero-byte file is left behind.

### Negative controls

**A — reintroduce a start.** Appending `node "$BIN" start` to `install.sh` → `FAIL — 176 passed, 7 failed, 0 blockers`. The edit touched `install.sh` only, so all seven reds are there; `install.ps1` stayed green throughout.

| Group | Red | Assertions that failed |
|-------|----:|------------------------|
| Source pattern scan — `install.sh` | 1 | `never invokes the tracker's start/stop/run-loop` |
| `install.sh` happy path | 3 | `exits 0`; `the only tracker invocation is login`; `never starts or stops a daemon` |
| `install.sh` HOME with a space | 3 | `exits 0`; `the only tracker invocation is login`; `never starts or stops a daemon` |
| Source pattern scan — `install.ps1` | 0 | — |
| `install.ps1` (all groups) | 0 | — |
| **Total** | **7** | |

One line of regression trips three independent mechanisms: the textual scan, and the runtime argv log on both happy paths. `exits 0` goes red because the stub refuses lifecycle verbs with exit 9, which `set -e` then propagates — so even a *successful* reintroduced start would still be caught by the other two.

**B — restore the false copy.** Putting `Nothing is being tracked yet` back → `FAIL — 177 passed, 6 failed`: source scan 2 (`states it did not start or stop a tracker`, `makes no claim about whether anything is being tracked`), happy path 2, HOME-with-a-space 2.

Both reverted → `PASS — 183 passed, 0 failed, 0 blockers`. The suite bites on the behaviour and on the wording; it is not vacuous.

### Post-revert verification

Confirmed by direct byte inspection after both negative-control round-trips, not assumed:

| File | Bytes | BOM | CR | LF | CRLF pairs | Lone CR | Parse |
|------|------:|-----|---:|---:|-----------:|--------:|-------|
| `install.ps1` | 4486 | **yes** (EF BB BF) | 84 | 84 | 84 | 0 | `[PSParser]::Tokenize` clean |
| `install.sh` | 3201 | **no** | 0 | 78 | 0 | 0 | `bash -n` clean |

So `install.ps1` is pure CRLF with a UTF-8 BOM and `install.sh` is pure LF with none — exactly what `scripts/normalize-eol.mjs` requires (it skips `.ps1`, and fails the Docker build on any CR in a shipped `.sh`).

No injected call survived the revert: the only occurrence of `node "$BIN" start` in `install.sh` is **line 68**, the printed line inside the heredoc (`  start:   node "$BIN" start`); an anchored search for a real invocation (`^\s*node "$BIN" (start|stop|run-loop)`) returns nothing, and the file still ends at `EOF`.

## Limitations

1. **Cross-file drift is not machine-checked.** The `start`/`status`/`stop` strings live in two places that cannot share a source: the installers print them from shell variables, `connectPrompt.ts` emits them in TypeScript. Each side is pinned by its own tests, so both can be green while disagreeing. Re-diff the printed lines against `buildStartCommand`/`buildStatusCommand`/`buildStopCommand` whenever either side changes.
2. **The two sides are textually different today, and both are correct.** The installers print the **expanded absolute path** (`$BIN` / `$Bin` are interpolated at print time); the web emits the **literal** `node "$HOME/.vibehub/app/vibehub-tracker.cjs" start`. Both are runnable and quoted, and the installer's form is now executed by the suite. The shared plan's line 43 describes the installer as printing the literal `"$HOME/…"` form — that wording is imprecise; the behaviour on both sides is fine.
3. **The source scan is textual, not semantic** — see the scope note above. An indirect or obfuscated spawn outside the sandboxed paths would not be caught by this script.
4. **`web/dist/tracker/install.{ps1,sh}` is stale** — still the daemon-starting build output. `vite build` copies `public/` verbatim and regenerates it. Do not hand-patch dist.
5. **Sandbox, not production.** Every run used a stub tracker and a localhost origin. Nothing was tested against the real Railway-served installer or the real server; that is the shared plan's deploy step.
6. **`install.sh` was exercised under Git Bash on Windows only.** No macOS or Linux run happened on this workstation. The script is POSIX `bash` with `set -euo pipefail` using only `curl`/`wc`/`tr`/`mkdir`, but a genuine macOS/Linux execution is still unproven — including whether the printed-command check would behave identically without Git Bash's path translation.
7. **The external agent classifier is outside our control.** These changes remove the persistence behaviour that triggered the refusal; they cannot guarantee any particular agent's safety verdict. A user may still have to run `start` in their own terminal.
