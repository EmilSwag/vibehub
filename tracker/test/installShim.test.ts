// The `vibehub-tracker` command the installers put on PATH.
//
// Everything this project documents is `vibehub-tracker <command>` - status, stop,
// `hooks install cursor` - but the connector only ever installed a .cjs and a private
// Node, so the name did not exist. Three installers now write a shim, and they must write
// the SAME one: `web/public/tracker/connect.sh`, `web/public/tracker/mac.sh` and
// `mac/pkg/scripts/postinstall`.
//
// Two kinds of check:
//   1. Parity and shape, read straight from the shipped scripts - byte-identical shim
//      block, LF-only, no token in the Mac path, checksum gate intact, `</dev/null` on
//      children, and the same two user-facing commands in the scripts and the README.
//   2. Behaviour, by extracting that block and running it under `bash` in a sandbox:
//      idempotent rewrite, a foreign file never clobbered, a stale target detected, and
//      argument/stdin/exit-code passthrough.
//
// Synthetic only: no installer is executed, nothing is downloaded, no real ~/.vibehub,
// ~/.local/bin or /usr/local/bin is read or written - every path below is inside a
// throwaway directory. `bash` is required only for group 2, which skips without it.

import { strict as assert } from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";

const repo = resolve(__dirname, "../..");
const CONNECT = join(repo, "web/public/tracker/connect.sh");
const CONNECT_PS1 = join(repo, "web/public/tracker/connect.ps1");
const MAC = join(repo, "web/public/tracker/mac.sh");
const POSTINSTALL = join(repo, "mac/pkg/scripts/postinstall");
const README = join(repo, "tracker/README.md");
const OPEN = "# >>> vibehub-shim v1";
const CLOSE = "# <<< vibehub-shim v1";

const read = (file: string): string => readFileSync(file, "utf8");
const shimBlock = (file: string): string => {
  const text = read(file);
  const start = text.indexOf(OPEN);
  const end = text.indexOf(CLOSE);
  assert.ok(start >= 0 && end > start, `${file} carries no shim block`);
  return text.slice(start, end + CLOSE.length);
};

const tempRoot = resolve(__dirname, "../../../.temp/vibehub-ai-only");
mkdirSync(tempRoot, { recursive: true });
const sandbox = mkdtempSync(join(tempRoot, "install-shim-"));
after(() => rmSync(sandbox, { recursive: true, force: true }));

let bash: string | null = null;
try {
  execFileSync("bash", ["--version"], { stdio: "ignore" });
  bash = "bash";
} catch { bash = null; }

/** Runs the extracted block plus `script` in a sandboxed bash, nothing else in scope. */
function runShell(script: string, cwd: string): { status: number; stdout: string; stderr: string } {
  const file = join(cwd, `case-${Math.random().toString(36).slice(2)}.sh`);
  writeFileSync(file, `${shimBlock(CONNECT)}\n${script}\n`, { mode: 0o700 });
  const result = spawnSync(bash as string, [file], { cwd, encoding: "utf8" });
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

describe("install shim: one writer, shipped identically by three installers", () => {
  it("is byte-identical in connect.sh, mac.sh and the pkg postinstall", () => {
    const connect = shimBlock(CONNECT);
    assert.equal(shimBlock(MAC), connect, "mac.sh drifted from connect.sh");
    assert.equal(shimBlock(POSTINSTALL), connect, "postinstall drifted from connect.sh");
    // The parts that make it safe, named so a rewrite cannot quietly drop one.
    for (const needle of ["vibehub_write_shim", "vibehub_shim_on_path", "grep -qF",
      "VIBEHUB_SHIM_MARK", "mv -f", "exec \"$VIBEHUB_NODE\""]) {
      assert.ok(connect.includes(needle), `the shared block lost ${needle}`);
    }
  });

  it("is actually called by each installer, with that installer's own paths", () => {
    assert.match(read(CONNECT), /vibehub_write_shim "\$SHIM" "\$BASE" "\$NODE" "\$BIN"/);
    assert.match(read(MAC), /vibehub_write_shim "\$USER_SHIM" "\$APP_BUNDLE" "\$APP_TRACKER\/node\/bin\/node"/);
    assert.match(read(POSTINSTALL), /vibehub_install_user_shim "\$CONSOLE_USER" "\$VIBEHUB_APP"/);
  });

  it("keeps the shipped scripts LF-only and syntactically valid", (t) => {
    for (const file of [CONNECT, MAC, POSTINSTALL]) {
      assert.equal(read(file).includes("\r"), false, `${file} gained CRLF line endings`);
      if (!bash) continue;
      const parsed = spawnSync(bash, ["-n", file], { encoding: "utf8" });
      assert.equal(parsed.status, 0, `${file}: ${parsed.stderr}`);
    }
    if (!bash) t.skip("bash is unavailable; syntax check skipped");
  });

  it("leaves the Mac path tokenless, checksum-gated and stdin-isolated", () => {
    const mac = read(MAC);
    assert.equal(/VIBEHUB_TOKEN|deviceToken|--token-stdin /.test(mac), false, "a token entered mac.sh");
    assert.match(mac, /\[ "\$ACTUAL" = "\$SHA256" \]/);
    assert.match(mac, /grep -Eq '\^\[0-9a-f\]\{64\}\$'/);
    // Under `curl … | bash` the script IS bash's stdin, so ANY child that can read stdin
    // eats the rest of the installer - not just sudo and open. Line continuations are
    // joined first, so a multi-line `curl ... \` is judged as the one command it is.
    const readsStdin = new Set(["curl", "shasum", "plutil", "installer", "open", "sudo",
      "tail", "cat", "grep", "sed", "awk", "tr", "xargs", "read"]);
    // Only mac.sh's own body: the shared shim block is a generator whose quoted strings
    // mention these names, and it is covered by its own parity and behaviour cases.
    const body = mac.slice(mac.indexOf(CLOSE) + CLOSE.length);
    for (const command of body.replace(/\\\n\s*/g, " ").split("\n")) {
      const code = command.replace(/^\s+/, "");
      if (!code || code.startsWith("#")) continue;
      // The command actually being run: the first word, or the first word of a command
      // substitution. A bare mention (a `for tool in curl …` list) is not an invocation.
      const spawned = [/^(?:[A-Za-z_][\w]*=\S*\s+)*([\w./-]+)/.exec(code)?.[1],
        /\$\(\s*([\w./-]+)/.exec(code)?.[1]].filter((name): name is string => Boolean(name));
      if (!spawned.some((name) => readsStdin.has(name))) continue;
      if (code.includes("|")) continue;              // a pipeline member reads the pipe
      if (/<[\s'"$\w/]/.test(code) || code.includes("<<")) continue;  // explicit redirect
      assert.ok(code.includes("</dev/null"), `child may read the installer's stdin: ${code}`);
    }
  });

  it("prints the same two user-facing commands the README documents", () => {
    for (const source of [read(CONNECT), read(MAC), read(README)]) {
      assert.ok(source.includes("vibehub-tracker hooks install cursor"));
      assert.ok(source.includes("vibehub-tracker hooks install windsurf"));
    }
    // PATH guidance is exact, not "add it to your PATH".
    for (const source of [read(CONNECT), read(MAC)]) {
      assert.ok(source.includes(".zshrc"), "no zsh guidance");
      assert.ok(source.includes(".bashrc"), "no bash guidance");
      // The scripts carry the line shell-escaped, so match its distinctive parts.
      assert.ok(source.includes("export PATH="), "no exact PATH line");
      assert.ok(source.includes(".local/bin:"), "the PATH line names no directory");
    }
  });

  it("ships a shim that removes itself once VibeHub is gone", () => {
    const block = shimBlock(CONNECT);
    // The removal is in the shim the installers WRITE, not in the installer.
    assert.ok(block.includes('rm -f -- "$0"'), "the shim cannot remove itself");
    assert.ok(block.includes("removed itself"), "the shim does not say it removed itself");
    // ...and it only does that when the whole install root is gone, never on a
    // half-finished upgrade, which a reinstall is about to repair.
    assert.ok(block.includes('if [ ! -d "$VIBEHUB_ROOT" ]; then'), "no install-root check");
    assert.ok(block.includes("this VibeHub install is incomplete"), "no repair branch");
    // The fallback when it cannot delete itself (root-owned /usr/local/bin).
    assert.ok(block.includes("sudo rm -f"), "no elevation hint");
  });

  it("documents `uninstall` as the deliberate other half", () => {
    assert.ok(read(README).includes("vibehub-tracker uninstall"));
    assert.ok(read(join(repo, "tracker/src/index.ts")).includes('.command("uninstall")'));
  });
});

describe("install shim: the pkg installs it per user, never as root", () => {
  const post = (): string => read(POSTINSTALL);
  /** Joins line continuations so a multi-line command is judged as one command. */
  const commands = (text: string): string[] =>
    text.replace(/\\\n\s*/g, " ").split("\n");

  it("writes into the console user's own ~/.local/bin, not /usr/local/bin", () => {
    assert.equal(/vibehub_write_shim "\/usr\/local\/bin/.test(post()), false,
      "the pkg still installs a root-owned launcher");
    assert.match(post(), /dir="\$HOME\/\.local\/bin"/);
    assert.match(post(), /vibehub_install_user_shim "\$CONSOLE_USER" "\$VIBEHUB_APP"/);
  });

  it("does the home writes AS the user, so there is no chown and no race to win", () => {
    // Checking harder cannot fix a TOCTOU on a directory the user controls. Root builds
    // the text in its own temp dir; the user's shell performs every write under $HOME.
    assert.match(post(), /sudo -u "\$vibehub_user" \/bin\/sh "\$vibehub_staged\/install\.sh"/);
    assert.match(post(), /mktemp -d/);
    assert.equal(/chown/.test(post().replace(/^#.*$/gm, "")), false,
      "root still changes ownership somewhere");
    // The user side re-checks the rules itself, because it is the half with the user's
    // privileges - symlinked .local, symlinked bin, and a foreign file.
    const userSide = post().slice(post().indexOf("VIBEHUB_USER_SIDE"));
    for (const rule of ['[ ! -L "$HOME/.local" ] || exit 1', '[ ! -L "$dir" ] || exit 1',
      'grep -qF "$mark" "$dest" 2>/dev/null || exit 1']) {
      assert.ok(userSide.includes(rule), `the user-side installer lost: ${rule}`);
    }
  });

  it("does nothing at all when there is no console user", () => {
    const body = post();
    const guard = body.indexOf('CONSOLE_USER" = "loginwindow"');
    const install = body.indexOf("vibehub_install_user_shim \"$CONSOLE_USER\"");
    assert.ok(guard > 0 && install > guard, "the shim is installed before the console-user guard");
    assert.match(body, /if \[ -z "\$CONSOLE_USER" \]/);
    assert.ok(body.includes("exit 0"), "the guard must exit instead of continuing");
  });

  it("resolves the home directory properly and refuses a strange one", (t) => {
    if (!bash) return t.skip("bash is unavailable");
    const body = post();
    const helper = body.slice(body.indexOf("# >>> vibehub-user-shim"), body.indexOf("# <<< vibehub-user-shim"));
    const script = [
      helper,
      'WORK="$(mktemp -d)"',
      'mkdir -p "$WORK/stubs" "$WORK/Users/casey"',
      'cat > "$WORK/stubs/dscl" <<STUB',
      "#!/bin/sh",
      'echo "NFSHomeDirectory: $WORK/Users/casey"',
      "STUB",
      'chmod 755 "$WORK/stubs/dscl"',
      'PATH="$WORK/stubs:$PATH"',
      'resolved="$(vibehub_user_home casey)"',
      'echo "ok=$? same=$([ "$resolved" = "$WORK/Users/casey" ] && echo yes || echo no)"',
      'cat > "$WORK/stubs/dscl" <<STUB',
      "#!/bin/sh",
      "exit 1",
      "STUB",
      'chmod 755 "$WORK/stubs/dscl"',
      'vibehub_user_home nobody-at-all >/dev/null; echo "missing=$?"',
      'rm -rf "$WORK"',
    ].join("\n");
    const file = join(sandbox, "resolve.sh");
    writeFileSync(file, `${script}\n`, { mode: 0o700 });
    const out = spawnSync(bash as string, [file], { encoding: "utf8" }).stdout;
    assert.match(out, /ok=0 same=yes/);
    assert.match(out, /missing=1/);
  });

  /** Runs the pkg's own installer function with `sudo` and `dscl` stubbed. */
  const runPkgInstall = (name: string, prepare: string[]): string => {
    const body = post();
    const helper = body.slice(body.indexOf("# >>> vibehub-user-shim"), body.indexOf("# <<< vibehub-user-shim"));
    const script = [
      shimBlock(POSTINSTALL),
      helper,
      'WORK="$(mktemp -d)"',
      'APP="$WORK/Applications/VibeHub.app"',
      'export HOME="$WORK/Users/casey"',
      'mkdir -p "$APP/Contents/Resources/tracker/node/bin" "$HOME" "$WORK/stubs"',
      'printf "#!/bin/sh\\n" > "$APP/Contents/Resources/tracker/node/bin/node"',
      'chmod 755 "$APP/Contents/Resources/tracker/node/bin/node"',
      'printf "fixture\\n" > "$APP/Contents/Resources/tracker/vibehub-tracker.cjs"',
      "# `sudo -u <user> cmd...` becomes `cmd...`: the drop to the user is simulated, and",
      "# the write still has to succeed with only the user's own shell doing it.",
      // Quoted delimiter: "$@" must survive into the stub, not be expanded while writing it.
      "cat > \"$WORK/stubs/sudo\" <<'STUB'",
      "#!/bin/sh",
      "shift 2",
      'exec "$@"',
      "STUB",
      "# chown must never be called at all; if it is, this records the fact.",
      'cat > "$WORK/stubs/chown" <<STUB',
      "#!/bin/sh",
      'echo called >> "$WORK/chown.log"',
      "STUB",
      'chmod 755 "$WORK/stubs/sudo" "$WORK/stubs/chown"',
      'PATH="$WORK/stubs:$PATH"',
      ...prepare,
      'vibehub_install_user_shim casey "$APP"; echo "rc=$?"',
      'SHIM="$HOME/.local/bin/vibehub-tracker"',
      'echo "written=$([ -f "$SHIM" ] && echo yes || echo no)"',
      'echo "app-rooted=$(grep -qF "$APP" "$SHIM" 2>/dev/null && echo yes || echo no)"',
      'echo "chowned=$([ -e "$WORK/chown.log" ] && echo yes || echo no)"',
      'echo "staged-left=$(ls -d "$WORK"/../tmp.* 2>/dev/null | wc -l)"',
      'rm -rf "$WORK"',
    ].join("\n");
    const file = join(sandbox, `${name}.sh`);
    writeFileSync(file, `${script}\n`, { mode: 0o700 });
    return spawnSync(bash as string, [file], { encoding: "utf8" }).stdout;
  };

  it("installs it through the user's own shell, with no chown anywhere", (t) => {
    if (!bash) return t.skip("bash is unavailable");
    const out = runPkgInstall("pkg-install", []);
    assert.match(out, /rc=0/);
    assert.match(out, /written=yes/);
    // Rooted at the app, so a Finder delete disarms it and it then removes itself.
    assert.match(out, /app-rooted=yes/);
    // The point of the redesign: root never owns the result, so nothing needs handing over.
    assert.match(out, /chowned=no/);
  });

  it("leaves a foreign command in the user's bin untouched", (t) => {
    if (!bash) return t.skip("bash is unavailable");
    const out = runPkgInstall("pkg-foreign", [
      'mkdir -p "$HOME/.local/bin"',
      'printf "#!/bin/sh\\necho someone elses tool\\n" > "$HOME/.local/bin/vibehub-tracker"',
    ]);
    assert.match(out, /rc=1/);
    assert.match(out, /chowned=no/);
  });

  it("refuses a symlinked ~/.local or ~/.local/bin rather than following it", (t) => {
    if (!bash) return t.skip("bash is unavailable");
    const out = runPkgInstall("pkg-symlink", [
      'mkdir -p "$WORK/elsewhere"',
      'ln -s "$WORK/elsewhere" "$HOME/.local" 2>/dev/null || true',
      'echo "sym=$([ -L "$HOME/.local" ] && echo yes || echo no)"',
    ]);
    if (out.includes("sym=no")) return t.skip("this platform does not create real symlinks");
    assert.match(out, /rc=1/);
    assert.match(out, /written=no/);
    assert.match(out, /chowned=no/);
  });
  it("sends the PATH line to the file the login shell actually reads", (t) => {
    if (!bash) return t.skip("bash is unavailable");
    // macOS Terminal starts a LOGIN shell, and a login bash reads ~/.bash_profile, never
    // ~/.bashrc - the usual advice is silently useless there, which is the bug this pins.
    const script = [
      shimBlock(CONNECT),
      'WORK="$(mktemp -d)"',
      'mkdir -p "$WORK/stubs"',
      // Quoted delimiter: the stub must keep its variable, not have it expanded now.
      "cat > \"$WORK/stubs/uname\" <<'STUB'",
      "#!/bin/sh",
      'echo "${VIBEHUB_FAKE_OS:-Linux}"',
      "STUB",
      'chmod 755 "$WORK/stubs/uname"',
      'PATH="$WORK/stubs:$PATH"',
      'HOME="$WORK/home"',
      'export VIBEHUB_FAKE_OS=Darwin',
      'echo "mac-bash=$(vibehub_shell_rc /bin/bash)"',
      'echo "mac-zsh=$(vibehub_shell_rc /bin/zsh)"',
      'export VIBEHUB_FAKE_OS=Linux',
      'echo "linux-bash=$(vibehub_shell_rc /bin/bash)"',
      'echo "other=$(vibehub_shell_rc /usr/bin/fish)"',
      'rm -rf "$WORK"',
    ].join("\n");
    const file = join(sandbox, "shell-rc.sh");
    writeFileSync(file, `${script}\n`, { mode: 0o700 });
    const out = spawnSync(bash as string, [file], { encoding: "utf8" }).stdout;
    assert.match(out, /mac-bash=.*\/\.bash_profile/);
    assert.match(out, /mac-zsh=.*\/\.zshrc/);
    assert.match(out, /linux-bash=.*\/\.bashrc/);
    assert.match(out, /other=.*\/\.profile/);
  });

  it("names the login-shell file everywhere the PATH fix is shown", () => {
    // Terminal entrances resolve it at run time; the pkg's summary page is static HTML
    // and has no terminal to print to, so it spells both out.
    for (const source of [read(CONNECT), read(MAC)]) {
      assert.ok(source.includes("vibehub_shell_rc"), "the PATH line is not shell-aware");
      assert.ok(source.includes(".bash_profile"), "no macOS login-bash guidance");
    }
    const conclusion = read(join(repo, "mac/pkg/resources/conclusion.html"));
    assert.ok(conclusion.includes(".zshrc"), "the pkg page shows no zsh line");
    assert.ok(conclusion.includes(".bash_profile"), "the pkg page shows no bash line");
    assert.ok(conclusion.includes("$HOME/.local/bin:$PATH"), "the pkg page shows no PATH line");
  });

});

describe("install shim: behaviour, in a sandbox", () => {
  const prepare = (name: string): { dir: string; node: string; cjs: string; shim: string } => {
    const dir = join(sandbox, name);
    mkdirSync(join(dir, "bin"), { recursive: true });
    const node = join(dir, "bin", "node");
    // A stand-in for the private runtime: prints what it was given, echoes stdin back.
    writeFileSync(node, "#!/bin/sh\nprintf 'ARGS:%s\\n' \"$*\"\ncat\nexit 7\n", { mode: 0o755 });
    chmodSync(node, 0o755);
    const cjs = join(dir, "vibehub-tracker.cjs");
    writeFileSync(cjs, "// fixture\n");
    return { dir, node, cjs, shim: join(dir, "local", "bin", "vibehub-tracker") };
  };

  it("writes a working command, then rewrites it in place on re-run", (t) => {
    if (!bash) return t.skip("bash is unavailable");
    const { dir, node, cjs, shim } = prepare("fresh");
    const first = runShell(`vibehub_write_shim '${shim}' '${dir}' '${node}' '${cjs}'; echo "rc=$?"`, dir);
    assert.match(first.stdout, /rc=0/);
    assert.ok(existsSync(shim));
    const written = readFileSync(shim, "utf8");
    // Re-running is an in-place rewrite: same single file, same content, no second copy.
    const again = runShell(`vibehub_write_shim '${shim}' '${dir}' '${node}' '${cjs}'; echo "rc=$?"`, dir);
    assert.match(again.stdout, /rc=0/);
    assert.equal(readFileSync(shim, "utf8"), written);
    // An upgrade that moves the runtime just repoints the same file.
    const moved = join(dir, "bin", "node2");
    writeFileSync(moved, readFileSync(node), { mode: 0o755 });
    chmodSync(moved, 0o755);
    runShell(`vibehub_write_shim '${shim}' '${dir}' '${moved}' '${cjs}'`, dir);
    assert.ok(readFileSync(shim, "utf8").includes("node2"));
    assert.equal(readFileSync(shim, "utf8").split("VIBEHUB_NODE=").length - 1, 1);
  });

  it("passes arguments, stdin and the exit code straight through", (t) => {
    if (!bash) return t.skip("bash is unavailable");
    const { dir, node, cjs, shim } = prepare("passthrough");
    runShell(`vibehub_write_shim '${shim}' '${dir}' '${node}' '${cjs}'`, dir);
    const result = spawnSync(bash, [shim, "hooks", "install", "cursor"],
      { cwd: dir, encoding: "utf8", input: "piped-stdin\n" });
    assert.match(result.stdout, /ARGS:.*hooks install cursor/);
    // `exec` keeps stdin attached - this is what `login --token-stdin` and `hook` need.
    assert.match(result.stdout, /piped-stdin/);
    assert.equal(result.status, 7, "the command's own exit code must survive");
  });

  it("never clobbers a vibehub-tracker that is not ours", (t) => {
    if (!bash) return t.skip("bash is unavailable");
    const { dir, node, cjs, shim } = prepare("foreign");
    mkdirSync(join(dir, "local", "bin"), { recursive: true });
    writeFileSync(shim, "#!/bin/sh\necho someone elses tool\n", { mode: 0o755 });
    const result = runShell(`vibehub_write_shim '${shim}' '${dir}' '${node}' '${cjs}'; echo "rc=$?"`, dir);
    assert.match(result.stdout, /rc=1/);
    assert.equal(readFileSync(shim, "utf8"), "#!/bin/sh\necho someone elses tool\n");
  });

  it("refuses to write through a symlink", (t) => {
    if (!bash) return t.skip("bash is unavailable");
    const { dir, node, cjs, shim } = prepare("symlink");
    mkdirSync(join(dir, "local", "bin"), { recursive: true });
    const target = join(dir, "elsewhere");
    writeFileSync(target, "keep me\n");
    const linked = runShell(`ln -s '${target}' '${shim}' 2>/dev/null || exit 3
vibehub_write_shim '${shim}' '${dir}' '${node}' '${cjs}'; echo "rc=$?"`, dir);
    if (linked.status === 3) return t.skip("this platform cannot create symlinks here");
    assert.match(linked.stdout, /rc=1/);
    assert.equal(readFileSync(target, "utf8"), "keep me\n");
  });

  it("deletes itself when the install root is gone, leaving nothing dangling", (t) => {
    if (!bash) return t.skip("bash is unavailable");
    const { dir, node, cjs, shim } = prepare("deleted");
    const root = join(dir, "root");
    mkdirSync(root, { recursive: true });
    runShell(`vibehub_write_shim '${shim}' '${root}' '${node}' '${cjs}'`, dir);
    assert.ok(existsSync(shim));
    rmSync(root, { recursive: true, force: true }); // VibeHub.app trashed / ~/.vibehub removed
    const result = spawnSync(bash, [shim, "status"], { cwd: dir, encoding: "utf8" });
    assert.equal(result.status, 127);
    assert.match(result.stderr, /removed itself/);
    assert.equal(existsSync(shim), false, "a dangling command was left on PATH");
  });

  it("does NOT delete itself while the install is merely incomplete", (t) => {
    if (!bash) return t.skip("bash is unavailable");
    const { dir, node, cjs, shim } = prepare("incomplete");
    const root = join(dir, "root");
    mkdirSync(root, { recursive: true });
    runShell(`vibehub_write_shim '${shim}' '${root}' '${node}' '${cjs}'`, dir);
    rmSync(cjs); // interrupted upgrade: the root is still there
    const result = spawnSync(bash, [shim, "status"], { cwd: dir, encoding: "utf8" });
    assert.equal(result.status, 127);
    assert.match(result.stderr, /incomplete/);
    assert.match(result.stderr, /reinstall/);
    assert.ok(existsSync(shim), "a repairable install must keep its command");
  });

  it("reports an unwritable location instead of pretending", (t) => {
    if (!bash) return t.skip("bash is unavailable");
    const { dir, node, cjs } = prepare("unwritable");
    // A path whose parent is a FILE can never be created, on any platform.
    const blocked = join(dir, "vibehub-tracker.cjs", "bin", "vibehub-tracker");
    const result = runShell(`vibehub_write_shim '${blocked}' '${dir}' '${node}' '${cjs}'; echo "rc=$?"`, dir);
    assert.match(result.stdout, /rc=2/);
  });

  it("knows whether a directory is on PATH", (t) => {
    if (!bash) return t.skip("bash is unavailable");
    const { dir } = prepare("path");
    const on = runShell(`PATH="/x:${dir}:/y" vibehub_shim_on_path '${dir}'; echo "rc=$?"`, dir);
    assert.match(on.stdout, /rc=0/);
    const off = runShell(`PATH="/x:/y" vibehub_shim_on_path '${dir}'; echo "rc=$?"`, dir);
    assert.match(off.stdout, /rc=1/);
  });
});

// The disclosure the user reads before anything is installed, and the two commands it
// points at. It is one text shipped by two connectors, so drift between them is a real
// product defect: the PO's last edit re-saved connect.sh as CRLF (which breaks a POSIX
// script at the shebang) and softened the hook reference to `hooks install <tool>`, a
// command that does not exist on Windows. Both are gated here, in the tracker's own suite,
// because that is where the commands themselves are defined.
describe("connector disclosure: one text, shipped by both connectors", () => {
  /** The disclosure lines of connect.sh, out of its quoted heredoc. */
  function shellLines(): string[] {
    const text = read(CONNECT);
    const open = "<<'DISCLOSURE'\n";
    const start = text.indexOf(open);
    const end = text.indexOf("\nDISCLOSURE\n", start);
    assert.ok(start >= 0 && end > start, "connect.sh carries no disclosure heredoc");
    return text.slice(start + open.length, end).split("\n").filter(Boolean);
  }

  /** The same lines out of connect.ps1's array, with PowerShell's own quoting undone. */
  function powerShellLines(): string[] {
    const text = read(CONNECT_PS1);
    const start = text.indexOf("foreach ($line in @(");
    const end = text.indexOf("\n  )) {", start);
    assert.ok(start >= 0 && end > start, "connect.ps1 carries no disclosure array");
    return text.slice(text.indexOf("\n", start) + 1, end).split("\n")
      .map((line) => line.trim().replace(/,$/, ""))
      .filter(Boolean)
      .map((literal) => {
        if (literal.startsWith("'") && literal.endsWith("'")) return literal.slice(1, -1).replace(/''/g, "'");
        if (literal.startsWith('"') && literal.endsWith('"')) return literal.slice(1, -1).replace(/`(.)/g, "$1");
        throw new Error(`not a PowerShell string literal: ${literal}`);
      });
  }

  it("says exactly the same thing on POSIX and on Windows", () => {
    const shell = shellLines();
    assert.ok(shell.length >= 9, `only ${shell.length} disclosure lines`);
    assert.deepEqual(powerShellLines(), shell, "the two connectors' disclosures have drifted");
  });

  it("names the two exact hook commands, never a placeholder", () => {
    for (const lines of [shellLines(), powerShellLines()]) {
      const text = lines.join("\n");
      assert.ok(text.includes("vibehub-tracker hooks install cursor"), "the cursor command is missing");
      assert.ok(text.includes("vibehub-tracker hooks install windsurf"), "the windsurf command is missing");
      // `hooks install <tool>` promised a command the user cannot type.
      assert.equal(/hooks install <\w+>/.test(text), false, "the disclosure still points at a placeholder");
    }
    // And the Windows connector must print them, not only describe them.
    const ps1 = read(CONNECT_PS1);
    for (const command of ["vibehub-tracker hooks install cursor", "vibehub-tracker hooks install windsurf"]) {
      assert.ok(ps1.includes(`'  ${command}'`), `connect.ps1 never prints: ${command}`);
    }
  });

  it("keeps connect.ps1 LF-only, ASCII, BOM-free and parseable", (t) => {
    const text = read(CONNECT_PS1);
    // LF: connect.ps1's committed state is LF, and the web installer gate normalises it.
    // Re-armed here so a tracker-side edit cannot reintroduce what W1 had to undo.
    assert.equal(text.includes("\r"), false, "connect.ps1 gained CRLF line endings");
    assert.equal(text.startsWith("\ufeff"), false, "connect.ps1 gained a BOM");
    // eslint-disable-next-line no-control-regex
    assert.equal(/[^\x00-\x7F]/.test(text), false, "connect.ps1 is no longer ASCII (PS 5.1 reads it as ANSI)");
    if (process.platform !== "win32") return t.skip("PowerShell parse needs Windows");
    const parsed = spawnSync("powershell", ["-NoProfile", "-Command",
      "$errors = $null; [void][Management.Automation.Language.Parser]::ParseFile(" +
      `'${CONNECT_PS1.replace(/'/g, "''")}', [ref]$null, [ref]$errors); ` +
      "if ($errors.Count) { throw ($errors | Out-String) }; Write-Output 'PARSE_OK'"],
      { encoding: "utf8" });
    assert.match(parsed.stdout ?? "", /PARSE_OK/, parsed.stderr ?? "no output");
  });

  it("points the Windows user at the launcher directory the tracker looks in", () => {
    const ps1 = read(CONNECT_PS1);
    // One directory, spelled the same way in the connector that writes the command and in
    // the code that finds it again - otherwise `uninstall` cannot remove what was written.
    assert.ok(ps1.includes("Programs\\VibeHub"), "connect.ps1 names no launcher directory");
    assert.ok(read(join(repo, "tracker/src/hooks/install.ts")).includes('"Programs", "VibeHub"'),
      "the tracker looks somewhere else for the launcher");
    // PATH guidance is the User-scope call, not setx - setx truncates PATH at 1024 chars.
    assert.ok(ps1.includes("[Environment]::SetEnvironmentVariable('Path'"), "no persistent PATH line");
    // `setx` may be NAMED - it is the obvious thing to reach for, so the connector says
    // why it is not the advice - but it must never be the command the user is told to run.
    assert.equal(/setx\s+["']?Path/i.test(ps1), false, "setx would truncate the user's PATH at 1024 characters");
    assert.ok(/setx[^\n]*truncat/i.test(ps1), "the connector does not say why setx is refused");
  });

  // F10: the user-facing docs described the launcher as POSIX-only long after Windows had
  // one, so a Windows reader was told to put `~/.local/bin` on PATH and, in the manual
  // removal, to delete a file that was never there.
  it("documents the Windows launcher everywhere it documents the POSIX one", () => {
    const INSTALL = join(repo, "docs/INSTALL.md");
    const ROOT_README = join(repo, "README.md");
    for (const file of [INSTALL, ROOT_README, README]) {
      const text = read(file);
      if (!text.includes(".local/bin")) continue;
      assert.ok(text.includes("Programs\\VibeHub"),
        `${file} names ~/.local/bin as the launcher's home but never the Windows one`);
    }
    // And the PATH line has to carry a RESOLVED directory. `SetEnvironmentVariable` stores
    // a user PATH as REG_SZ, so a literal `%LOCALAPPDATA%` would sit there unexpanded and
    // match nothing - the entry would look right and do nothing at all.
    for (const file of [INSTALL, ROOT_README, README, CONNECT_PS1]) {
      assert.equal(/SetEnvironmentVariable\([^\n]*%LOCALAPPDATA%/.test(read(file)), false,
        `${file} appends an unexpanded %LOCALAPPDATA% to PATH`);
    }
  });
});
