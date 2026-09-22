#!/usr/bin/env node
/**
 * Synthetic connector tests. No real tracker import/execution; no official runtime
 * execution, AI files, user credentials, package installs or non-loopback traffic.
 * All spawned programs get an allowlisted environment and a throwaway home BEFORE
 * invocation. PS profiles and Bash startup files are disabled. No policy override.
 * Only disposable script copies get fixture origins/hashes/probes/short deadlines.
 * Production scripts have no test flags. Mocks do NOT prove native macOS/ARM support.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { hash, shQuote, psQuote, tarFixture, zipFixture, driverSource, trackerSource, fakeRuntimeCSharp } from './connect-test-fixtures.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workspace = path.dirname(repo);
const assets = path.join(repo, 'web/public/tracker');
const output = path.join(workspace, '.temp/qa/one-command-connect');
fs.mkdirSync(output, { recursive: true });
// Opt-in only (unset by default): saves one real success/failure stdout+stderr
// sample for a QA report. Never changes assertions or default CI behavior.
const sampleDir = process.env.VH_SAMPLE_DIR || '';
if (sampleDir) fs.mkdirSync(sampleDir, { recursive: true });
const root = fs.mkdtempSync(path.join(output, 'run-'));
const marker = 'VIBEHUB CONNECT SYNTHETIC ONLY';
const fakeToken = 'synthetic_device_token_0123456789abcdef';
const windows = process.platform === 'win32';
const posix = (value) => windows ? value.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => '/' + drive.toLowerCase()) : value;
const read = (file) => fs.readFileSync(file, 'utf8');
const jsonLines = (file) => fs.existsSync(file) ? read(file).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
const sources = { posix: read(path.join(assets, 'connect.sh')), windows: read(path.join(assets, 'connect.ps1')) };
const manifest = JSON.parse(read(path.join(assets, 'runtime-manifest.json')));
const results = { host: { platform: process.platform, arch: process.arch, release: os.release(), node: process.version }, cases: [], checks: 0, failures: 0, skips: [], blockers: [], safety: 'Synthetic homes/runtime/tracker only. No real collector or official executable run.' };
const selected = process.argv.slice(2);
assert(selected.length === 0 || ([2, 4].includes(selected.length) && selected[0] === '--group' && ['posix', 'windows', 'static'].includes(selected[1]) && (selected.length === 2 || (selected[2] === '--match' && selected[3]))), 'Use --group posix|windows|static [--match case-substring], or no arguments');
const group = selected[1] || 'all';
const caseMatch = selected[3] || '';
const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows';
const systemPath = windows ? [path.join(systemRoot, 'System32'), path.join(systemRoot, 'System32/WindowsPowerShell/v1.0')].join(';') : '/usr/bin:/bin:/usr/sbin:/sbin';
const bash = windows ? [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git/bin/bash.exe'), 'C:\\Program Files\\Git\\usr\\bin\\bash.exe'].find(fs.existsSync) : '/bin/bash';
const powershell = path.join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
const allowedExecutables = new Set([bash, powershell, process.execPath].filter(Boolean));
const snapshots = new Map(['install.sh', 'install.ps1', 'vibehub-tracker.cjs', 'connect.sh', 'connect.ps1', 'runtime-manifest.json'].map((name) => [path.join(assets, name), hash(fs.readFileSync(path.join(assets, name)))]));
for (const file of ['web/scripts/test-one-command-connect.mjs', 'web/scripts/connect-test-fixtures.mjs', 'web/scripts/normalize-connect-installers.mjs', 'web/src/lib/connectPrompt.ts']) {
  const absolute = path.join(repo, file);
  snapshots.set(absolute, hash(fs.readFileSync(absolute)));
}
results.startedAt = new Date().toISOString();
results.sourceHashes = Object.fromEntries([...snapshots].map(([file, sum]) => [path.relative(repo, file).replaceAll('\\', '/'), sum]));
let sequence = 0;

function inside(file, base = root) {
  const relative = path.relative(base, path.resolve(file));
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
function write(file, content, mode) {
  assert(inside(file), 'ISOLATION: write escaped test root');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, mode ? { mode } : undefined);
}
function homeEnv(label) {
  const home = path.join(root, String(++sequence).padStart(3, '0') + '-' + label, "Home with spaces O'Neil $cash");
  write(path.join(home, '.sandbox-marker'), marker);
  const env = {};
  for (const key of ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'PROCESSOR_ARCHITECTURE', 'PROCESSOR_ARCHITEW6432', 'NUMBER_OF_PROCESSORS']) if (process.env[key]) env[key] = process.env[key];
  Object.assign(env, {
    HOME: home, USERPROFILE: home, HOMEDRIVE: windows ? path.parse(home).root.slice(0, 2) : '', HOMEPATH: windows ? home.slice(2) : home,
    APPDATA: path.join(home, 'AppData/Roaming'), LOCALAPPDATA: path.join(home, 'AppData/Local'),
    TEMP: path.join(home, 'tmp'), TMP: path.join(home, 'tmp'), TMPDIR: path.join(home, 'tmp'),
    CLAUDE_CONFIG_DIR: path.join(home, 'fake-ai/claude'), CODEX_HOME: path.join(home, 'fake-ai/codex'), QUADCODE_HOME: path.join(home, 'fake-ai/quadcode'),
    XDG_CONFIG_HOME: path.join(home, 'xdg/config'), XDG_DATA_HOME: path.join(home, 'xdg/data'), XDG_CACHE_HOME: path.join(home, 'xdg/cache'),
    PATH: systemPath, NO_PROXY: '*', no_proxy: '*', LANG: 'C', LC_ALL: 'C',
    VH_TEST_ROOT: root, VH_TEST_HOME: home, VH_TEST_LOG: path.join(home, 'commands.jsonl'), VH_TEST_AUDIT: path.join(home, 'audit.jsonl'),
    VH_NODE_DRIVER: path.join(root, 'fake-node-driver.cjs'), VH_REAL_NODE: process.execPath,
  });
  for (const key of ['APPDATA', 'LOCALAPPDATA', 'TEMP', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'QUADCODE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME']) fs.mkdirSync(env[key], { recursive: true });
  return env;
}
function assertIsolation(env, cwd) {
  assert(inside(cwd) && inside(env.HOME) && cwd === env.VH_TEST_HOME, 'ISOLATION: cwd/home escaped');
  assert.equal(env.USERPROFILE, env.HOME);
  assert.equal(env.HOMEDRIVE + env.HOMEPATH, env.HOME);
  assert.equal(read(path.join(env.HOME, '.sandbox-marker')), marker);
  assert.notEqual(path.resolve(env.HOME), path.resolve(os.homedir()));
  for (const key of ['APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'TMPDIR', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'QUADCODE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME']) assert(inside(env[key], env.HOME), 'ISOLATION: ' + key);
  for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'BASH_ENV', 'ENV', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) assert(!env[key], 'ISOLATION: inherited injection/proxy ' + key);
  assert(!env.VIBEHUB_TOKEN || env.VIBEHUB_TOKEN === fakeToken || env.VIBEHUB_TOKEN === fakeToken + '\n' || env.VIBEHUB_TOKEN === 'bad token\nsecret', 'ISOLATION: non-synthetic token');
}
async function run(executable, args, env, { input = '', timeout = 30000 } = {}) {
  assert(allowedExecutables.has(executable), 'ISOLATION: unexpected executable');
  assertIsolation(env, env.VH_TEST_HOME); // Mandatory BEFORE every invocation, including parser/compiler probes.
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: env.VH_TEST_HOME, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = ''; let stderr = ''; let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, text: stdout + stderr, timedOut }); });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
const psGuard = `
$ErrorActionPreference = 'Stop'
if (-not $env:VH_TEST_ROOT -or -not $env:VH_TEST_HOME.StartsWith($env:VH_TEST_ROOT + '\\')) { throw 'ISOLATION: missing root' }
Set-Variable -Name HOME -Value $env:VH_TEST_HOME -Force -Scope Global
if ($HOME -ne $env:USERPROFILE -or ($env:HOMEDRIVE + $env:HOMEPATH) -ne $HOME) { throw 'ISOLATION: home mismatch' }
if ([IO.File]::ReadAllText((Join-Path $HOME '.sandbox-marker')) -ne '${marker}') { throw 'ISOLATION: missing marker' }
`;
const encoded = (script) => Buffer.from(script, 'utf16le').toString('base64');
const runPS = (script, env, options) => run(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded(psGuard + script)], env, options);
async function test(name, action) {
  if (caseMatch && /^(posix|windows): /.test(name) && !name.includes(caseMatch)) return false;
  try {
    const outcome = await action();
    const status = outcome === false ? 'SKIP' : 'PASS';
    results.cases.push({ name, status }); console.log(status + ' ' + name);
  }
  catch (error) { results.failures++; results.cases.push({ name, status: 'FAIL', error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); }
}
function check(condition, message) { results.checks++; assert(condition, message); }
function equal(actual, expected, message) { results.checks++; assert.deepEqual(actual, expected, message); }
function noSuccess(result) { check(result.code !== 0 && !result.timedOut, 'Failure must be a connector nonzero, not a harness timeout\n' + result.text); check(!result.text.includes('Installed in ~/.vibehub'), 'No install success on failure'); }

// One loopback fixture server, never the VibeHub application server. No outbound
// networking exists in this harness. Connections are closed before final cleanup.
let scenario = null;
const sockets = new Set();
const fixtureServer = http.createServer((req, res) => {
  try {
    assert(scenario && (req.socket.remoteAddress === '127.0.0.1' || req.socket.remoteAddress === '::ffff:127.0.0.1'), 'ISOLATION: non-loopback peer');
    const kind = req.url.startsWith('/dist/') ? 'node' : req.url === '/tracker/vibehub-tracker.cjs' ? 'bundle' : req.url === '/api/v1/tracker/verify' ? 'verify' : 'unknown';
    scenario.requests.push({ url: req.url, kind, authorization: req.headers.authorization || null });
    assert(kind !== 'unknown', 'ISOLATION: unexpected route');
    if (kind === 'verify') assert.equal(req.headers.authorization, 'Bearer ' + fakeToken);
    else assert(!req.headers.authorization, 'ISOLATION: token sent to a public/runtime download');
    let body = kind === 'node' ? scenario.archives[path.posix.basename(req.url)] : kind === 'bundle' ? Buffer.from(trackerSource) : Buffer.from('{"username":"synthetic"}');
    assert(body, 'ISOLATION: no fixture for requested runtime');
    const issue = scenario.options.target === kind ? scenario.options.issue : null;
    if (issue === 'timeout') return; // Deliberately stalled; script-copy deadline is one second.
    if (issue === 'status') { res.writeHead(kind === 'verify' ? 401 : 503); res.end('synthetic rejection'); return; }
    if (issue === 'redirect') { res.writeHead(302, { Location: '/must-not-follow' }); res.end('synthetic redirect'); return; }
    if (issue === 'empty') body = Buffer.alloc(0);
    if (issue === 'corrupt') body = Buffer.from('corrupt fixture, not a runtime');
    if (issue === 'invalid') body = Buffer.from(kind === 'verify' ? '<html>not JSON</html>' : '<html>' + 'bad '.repeat(400) + '</html>');
    if (issue === 'shape') body = Buffer.from('{"ok":true}');
    if (issue === 'oversize') { res.writeHead(200, { 'Content-Length': 999999999 }); res.end('oversize'); return; }
    if (issue === 'chunked-oversize') { res.writeHead(200, { 'Transfer-Encoding': 'chunked' }); res.end(Buffer.alloc(kind === 'verify' ? 17000 : 8388609, 120)); return; }
    if (issue === 'truncate') { res.writeHead(200, { 'Content-Length': body.length + 500 }); res.end(body.subarray(0, Math.min(body.length, 30))); return; }
    res.writeHead(200, { 'Content-Length': body.length, 'Content-Type': kind === 'verify' ? 'application/json' : 'application/octet-stream' });
    res.end(body);
  } catch (error) { if (scenario) scenario.serverError = error; res.writeHead(500); res.end('fixture assertion failed'); }
});
fixtureServer.on('connection', (socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
let origin = '';
const driver = path.join(root, 'fake-node-driver.cjs');
write(driver, driverSource);

async function staticTests() {
  await test('static: bytes, consent boundary, pinned trust and no global side effects', async () => {
    check(!sources.posix.includes('\r'), 'connect.sh must be LF-only');
    check([...fs.readFileSync(path.join(assets, 'connect.ps1'))].every((byte) => byte < 128), 'PS5.1 ASCII/no BOM');
    check(sources.windows.includes('param([switch]$Start)'), 'Explicit -Start switch');
    check(sources.posix.includes('case "$arg" in --start)'), 'Explicit --start argument');
    for (const source of Object.values(sources)) {
      // Scripts must not execute policy bypass, autostart, package managers, process enumeration, or environment mutations.
      // Filter out purely advisory console output lines (e.g. manual PATH setup advice or cleanup tips).
      const executableLines = source.split(/\r?\n/).filter(line => !/^\s*(?:Write-Host|printf)\b/.test(line)).join('\n');
      check(!/ExecutionPolicy|SetEnvironmentVariable|schtasks|Register-ScheduledTask|LaunchAgents|launchctl|systemctl|crontab|\bnpm\s+install\b|winget|choco|\bsudo\s|Get-Process|Get-CimInstance|tasklist|wmic/i.test(executableLines), 'No policy bypass/package manager/autostart/process enumeration');
      check(!/nothing unrelated|no file contents|no prompts ever/i.test(source), 'No false privacy guarantee');
      check(!/window titles?|process names/i.test(source), 'No stale process/window-title collection claim (removed from the active detector)');
      check(source.includes('~/.claude/projects') && source.includes('~/.codex/sessions'), 'Disclosure names the exact supported AI log roots');
      check(/not saved or sent/i.test(source), 'Disclosure states locally-read prompt/code/tool-output content is not saved or sent');
      check(/Uploads:.*token counts.*bounded project alias/i.test(source), 'Disclosure states exactly what is uploaded');
      check(/profiles and statistics.*are public/i.test(source), 'Disclosure states profiles/statistics are public');
      check(/Connected means a recent server-accepted tracker connection/i.test(source), 'Disclosure defines Connected precisely');
      check(/Idle means no recent supported AI activity/i.test(source), 'Disclosure defines Idle precisely');
      check(source.indexOf('Local reads:') < source.indexOf('vibehub-start-anchor'), 'Disclosure before start');
      check(source.includes('https://nodejs.org/dist') && !/VIBEHUB_(?:NODE|RUNTIME)_/.test(source), 'No Node trust override');
      check(!source.includes('Connected: yes'), 'Never echo a cached connection claim');
      check(!source.includes('runtime-manifest.json'), 'Do not trust downloaded manifests');
    }
    check(sources.posix.indexOf('$(sha256 "$archive")') < sources.posix.indexOf('tar -xzf'), 'Hash before POSIX extraction');
    check(sources.windows.indexOf('Get-FileHash -LiteralPath $archive') < sources.windows.indexOf('[IO.Compression.ZipFile]::OpenRead'), 'Hash before Windows extraction');
    equal(manifest.origin, 'https://nodejs.org/dist', 'Official fixed origin');
    equal(Object.keys(manifest.platforms).sort(), ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win-arm64', 'win-x64'], 'Deliberate platform set');
    for (const [platform, pin] of Object.entries(manifest.platforms)) {
      check(/^[a-f0-9]{64}$/.test(pin.sha256), 'Valid SHA-256 pin ' + platform);
      check(sources[platform.startsWith('win-') ? 'windows' : 'posix'].includes(pin.sha256), 'Embedded pin matches manifest ' + platform);
      check(pin.file.includes(manifest.version), 'Versioned archive ' + platform);
    }
    const checksumFile = path.join(workspace, '.temp/downloads/one-command-connect/SHASUMS256-' + manifest.version + '.txt');
    if (fs.existsSync(checksumFile)) {
      const official = new Map(read(checksumFile).trim().split(/\r?\n/).map((line) => { const [sum, file] = line.trim().split(/\s+/); return [file, sum]; }));
      for (const pin of Object.values(manifest.platforms)) equal(pin.sha256, official.get(pin.file), 'Independent official SHASUMS256 snapshot: ' + pin.file);
      results.officialChecksums = checksumFile;
    } else results.skips.push('Official downloaded SHASUMS256 snapshot not present; embedded-pin consistency only.');
  });
}

let tools = {};
async function prepareBash() {
  if (!bash || !fs.existsSync(bash)) { results.skips.push('Bash unavailable; no POSIX execution.'); return false; }
  const env = homeEnv('bash-probe');
  const names = ['basename', 'dirname', 'cat', 'chmod', 'mkdir', 'mv', 'rm', 'rmdir', 'mktemp', 'wc', 'tr', 'grep', 'tar', 'gzip', 'curl', 'sha256sum', 'shasum', 'uname'];
  const found = await run(bash, ['--noprofile', '--norc', '-c', 'for t in ' + names.join(' ') + '; do location="$(command -v "$t" || true)"; printf "%s=%s\\n" "$t" "$location"; done'], { ...env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' });
  equal(found.code, 0, 'Bash tool discovery');
  tools = Object.fromEntries(found.stdout.trim().split(/\r?\n/).map((line) => line.split('=')));
  results.shellTools = { stdout: found.stdout, stderr: found.stderr };
  for (const name of names.filter((name) => !['shasum', 'sha256sum'].includes(name))) check(tools[name], 'Missing shell prerequisite ' + name + '\n' + found.stdout + found.stderr);
  check(tools.shasum || tools.sha256sum, 'A real SHA-256 tool is required for tests');
  const syntax = await run(bash, ['--noprofile', '--norc', '-n', posix(path.join(assets, 'connect.sh'))], env);
  equal(syntax.code, 0, 'bash -n public connector');
  results.bash = { executable: bash, hostPlatform: process.platform, platformSelection: 'mocked uname/sw_vers/getconf for portable cases' };
  return true;
}
function nativeShellArguments() {
  let guard = '';
  // Native Windows curl/Node do not share MSYS filesystem semantics. Convert
  // fixture file arguments explicitly, including apostrophes. Product Git Bash
  // is still rejected before any bootstrap; this is not native Linux/Mac proof.
  if (windows) guard += 'converted=()\nfor value in "$@"; do\n  if [[ "$value" =~ ^/([a-zA-Z])/(.*)$ ]]; then value="${BASH_REMATCH[1]}:/${BASH_REMATCH[2]}"; fi\n  converted+=("$value")\ndone\nset -- "${converted[@]}"\nexport MSYS2_ARG_CONV_EXCL="*"\n';

  return guard;
}
function shellRuntime(version) {
  return `#!/bin/bash\n[ -n "$VH_TEST_ROOT" ] && [ -n "$VH_TEST_HOME" ] && [ "$USERPROFILE" = "$VH_TEST_HOME" ] || exit 91\nset -- "$0" "$@"\n${nativeShellArguments()}exec ${shQuote(posix(process.execPath))} ${shQuote(driver.replaceAll('\\', '/'))} ${shQuote(version)} "$@" 2>> "$HOME/runtime-errors.log"\n`;
}
function prepareShellTools(env, options) {
  const dir = path.join(env.HOME, 'fixture-tools');
  for (const [name, tool] of Object.entries(tools)) if (tool) {
    let guard = '';
    if (name === 'curl') guard = `case "\${@: -1}" in ${shQuote(origin)}/*) ;; *) echo 'ISOLATION: external curl blocked' >&2; exit 91 ;; esac\n`;
    if (name === 'tar') guard = `printf 'tar\\n' >> ${shQuote(posix(path.join(env.HOME, 'tools.log')))}\n`;
    if (name === 'mv' && options.promoteFailure) {
      const target = { license: 'runtime/LICENSE', runtime: 'runtime/bin/node', bundle: 'app/vibehub-tracker.cjs' }[options.promoteFailure];
      assert(target, 'Unknown fixture promotion failure');
      guard = `if [ "\${@: -1}" = ${shQuote(posix(path.join(env.HOME, '.vibehub', target)))} ]; then printf '%s' ${shQuote(options.promoteFailure)} > "$HOME/promotion-failure.log"; exit 12; fi\n`;
    }

    if (name === 'curl') guard += nativeShellArguments();
    const diagnostic = ['curl', 'tar'].includes(name) ? ` 2>> "$HOME/${name}-errors.log"` : '';
    write(path.join(dir, name), '#!/bin/bash\n' + guard + 'exec ' + shQuote(tool) + ' "$@"' + diagnostic + '\n', 0o700);
  }
  if (!options.nativeProbe) write(path.join(dir, 'uname'), '#!/bin/bash\ncase "$1" in -s) printf "%s\\n" "$VH_UNAME_S" ;; -m) printf "%s\\n" "$VH_UNAME_M" ;; -r) printf "%s\\n" "$VH_UNAME_R" ;; *) exit 2 ;; esac\n', 0o700);
  write(path.join(dir, 'sw_vers'), '#!/bin/bash\nprintf "%s\\n" "$VH_SW_VERS"\n', 0o700);
  write(path.join(dir, 'getconf'), '#!/bin/bash\n[ "$VH_GLIBC" != musl ] || exit 1\nprintf "%s\\n" "$VH_GLIBC"\n', 0o700);
  if (options.noHash) for (const name of ['sha256sum', 'shasum']) fs.rmSync(path.join(dir, name), { force: true });
  env.PATH = posix(dir); // No system Node can be discovered, even when /usr/bin/node exists.
  Object.assign(env, { VH_UNAME_S: options.os || 'Linux', VH_UNAME_M: options.arch || 'x86_64', VH_UNAME_R: options.kernel || '6.8.0', VH_SW_VERS: options.macVersion || '13.5', VH_GLIBC: options.glibc || 'glibc 2.28' });
  return dir;
}

const compiled = new Map();
async function preparePowerShell() {
  if (!windows || !fs.existsSync(powershell)) { results.skips.push('Native Windows PowerShell 5.1 unavailable; no native Windows execution.'); return false; }
  const env = homeEnv('powershell-probe');
  const parsed = await runPS(`$tokens = $null; $errors = $null; [void][Management.Automation.Language.Parser]::ParseFile(${psQuote(path.join(assets, 'connect.ps1'))}, [ref]$tokens, [ref]$errors); if ($errors.Count) { throw ($errors | Out-String) }; Write-Output 'PARSE_OK'`, env);
  equal(parsed.code, 0, 'Native PowerShell parser: ' + parsed.text);
  results.powershellParser = 'PASS (parse only, no connector execution)';

  const gateFile = path.join(root, 'policy-probe.ps1');
  write(gateFile, psGuard + "Write-Output ('PS_VERSION=' + $PSVersionTable.PSVersion.ToString())\nWrite-Output 'POLICY_ALLOWED'\n");
  const gate = await run(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', gateFile], env);
  if (gate.code !== 0 || !gate.stdout.includes('POLICY_ALLOWED')) {
    results.blockers.push('Windows script file execution blocked/unavailable; connector runtime cases not executed, no policy bypass: ' + gate.text);
    return false;
  }
  results.powershell = gate.stdout.trim();

  for (const version of [manifest.version, 'v22.0.0', 'v16.0.0']) {
    const source = path.join(root, 'runtime-' + version + '.cs'); const exe = path.join(root, 'runtime-' + version + '.exe');
    write(source, fakeRuntimeCSharp(version));
    const build = await runPS(`Add-Type -TypeDefinition ([IO.File]::ReadAllText(${psQuote(source)})) -Language CSharp -OutputAssembly ${psQuote(exe)} -OutputType ConsoleApplication; Write-Output 'FAKE_RUNTIME_READY'`, env, { timeout: 60000 });
    equal(build.code, 0, 'Compile guarded fake runtime, no policy workaround: ' + build.text);
    compiled.set(version, fs.readFileSync(exe));
  }
  return true;
}

function sourceCopy(kind, archives, options) {
  let source = sources[kind];
  // Prevent ANY production network fallback, even if env-origin selection regresses.
  source = source.replaceAll('https://web-production-da778.up.railway.app', 'http://127.0.0.1:1')
    .replaceAll('https://server-production-cc06.up.railway.app', 'http://127.0.0.1:1')
    .replaceAll('https://nodejs.org/dist', origin + '/dist');
  if (!options.productionPins) for (const pin of Object.values(manifest.platforms)) if (archives[pin.file]) source = source.replaceAll(pin.sha256, hash(archives[pin.file]));
  if (options.originProbe) {
    // Test the actual origin grammar only, then return before install/network work.
    // A missed hook still cannot contact these .example hosts: transport guards deny it.
    if (kind === 'windows') source = source.replace('  if ($HOME -notmatch', "  Write-Host ('ORIGIN_WEB=' + $WebUrl)\n  Write-Host ('ORIGIN_API=' + $ApiUrl)\n  return\n  if ($HOME -notmatch");
    else source = source.replace('  API_URL="$(origin "$API_URL")"', '  API_URL="$(origin "$API_URL")"\n  printf "ORIGIN_WEB=%s\\nORIGIN_API=%s\\n" "$WEB_URL" "$API_URL"\n  return 0');
  }
  if (kind === 'windows') {
    source = source.replace('  $handler = New-Object Net.Http.HttpClientHandler', `  if (-not $Url.StartsWith($env:VH_TEST_ORIGIN + '/')) { throw 'ISOLATION: non-loopback URL blocked' }\n  $handler = New-Object Net.Http.HttpClientHandler\n  $handler.UseProxy = $false`);
    if (options.promoteFailure) {
      const target = { license: 'runtime/LICENSE', runtime: 'runtime/node.exe', bundle: 'app/vibehub-tracker.cjs' }[options.promoteFailure];
      assert(target, 'Unknown fixture promotion failure');
      source = source.replace('  Assert-File $Destination', `  if ($Destination -eq (Join-Path $Base ${psQuote(target)})) { [IO.File]::WriteAllText((Join-Path $HOME 'promotion-failure.log'), ${psQuote(options.promoteFailure)}); Stop-Connect 'Synthetic promotion denied.' }\n  Assert-File $Destination`);
    }
    if (options.arch) source = source.replace('  $Architecture = switch ($osArchitecture)', `  $osArchitecture = ${psQuote(options.arch)}\n  $Architecture = switch ($osArchitecture)`);
    if (options.issue === 'timeout' || options.issue === 'truncate') source = source.replace('[TimeSpan]::FromSeconds($Seconds)', '[TimeSpan]::FromSeconds(1)');
    if (options.skipIntegrity) source = source.replace('if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -cne $hash)', 'if ($false)');
    if (options.forceStart) source = source.replace('  if ($Start) {\n    $AttemptedStart = $true', '  if ($true) {\n    $AttemptedStart = $true');
  } else {
    if (options.issue === 'timeout' || options.issue === 'truncate') source = source.replace('--max-time "$seconds"', '--max-time 1');
    if (options.skipIntegrity) source = source.replace('[ "$(sha256 "$archive")" = "$hash" ] || fail', 'true || fail');
    if (options.forceStart) source = source.replace('  if [ "$START" -eq 1 ]; then\n    ATTEMPTED_START=1', '  if true; then\n    ATTEMPTED_START=1');
  }
  return source;
}
function fixture(kind, options = {}) {
  const env = homeEnv(kind);
  const base = path.join(env.HOME, '.vibehub');
  const runtime = path.join(base, kind === 'windows' ? 'runtime/node.exe' : 'runtime/bin/node');
  const bin = path.join(base, 'app/vibehub-tracker.cjs');
  const toolsDir = kind === 'posix' ? prepareShellTools(env, options) : path.join(env.HOME, 'fixture-tools');
  const runtimeBytes = (version) => kind === 'posix' ? Buffer.from(shellRuntime(version)) : compiled.get(version);
  if (kind === 'windows') { fs.mkdirSync(toolsDir, { recursive: true }); env.PATH = toolsDir + ';' + systemPath; }
  if (options.global) write(path.join(toolsDir, kind === 'windows' ? 'node.exe' : 'node'), runtimeBytes(options.global), 0o700);
  if (options.private) write(runtime, runtimeBytes(options.private), 0o700);
  if (options.existing) {
    write(bin, '// Previous synthetic install; must survive failed download/login.\n');
    write(path.join(base, 'config.json'), JSON.stringify({ deviceToken: 'previous-synthetic-token', projectAliases: { 'fixture-only': 'Alias' } }));
    write(path.join(base, 'tracker.pid'), '42424242\n');
    write(path.join(base, 'status.json'), '{"lastHeartbeatAt":"2000-01-01T00:00:00.000Z"}\n');
  }
  if (options.lock) write(path.join(base, '.connect.lock/owner-marker'), 'another synthetic installer');
  Object.assign(env, {
    VIBEHUB_TOKEN: options.token === undefined ? fakeToken : options.token,
    VIBEHUB_WEB_URL: options.origin || origin, VIBEHUB_API_URL: options.apiOrigin || origin,
    VH_TEST_ORIGIN: origin, VH_TRACKER_MODE: options.mode || 'ok', VH_BREAK_BOOT: options.breakBoot ? '1' : '0',
  });
  const archives = {};
  for (const [platform, pin] of Object.entries(manifest.platforms)) {
    if (platform.startsWith('win-') !== (kind === 'windows')) continue;
    const name = pin.file.replace(/\.(?:tar\.gz|zip)$/, '');
    archives[pin.file] = (kind === 'windows' ? zipFixture : tarFixture)(name, runtimeBytes(options.bootVersion || manifest.version), { layout: !options.badLayout });
  }
  const file = path.join(path.dirname(env.HOME), kind === 'posix' ? 'connect-fixture.sh' : 'connect-fixture.ps1');
  write(file, sourceCopy(kind, archives, options));
  const state = { kind, env, base, runtime, bin, file, options, archives, requests: [], serverError: null };
  state.invoke = async () => {
    scenario = state;
    assertIsolation(env, env.VH_TEST_HOME);
    let result;
    if (kind === 'posix') {
      const wanted = options.global ? posix(path.join(toolsDir, 'node')) : '';
      // Git Bash prepends its own /usr/bin even to a supplied PATH. Reset it
      // inside the isolated shell, before the product's exact bash -s -- form.
      const guard = `export HOME=${shQuote(posix(env.HOME))}\nexport PATH=${shQuote(posix(toolsDir))}\n[ "$USERPROFILE" = "$VH_TEST_HOME" ] || exit 91\n[ "$(type -P node || true)" = ${shQuote(wanted)} ] || { echo 'ISOLATION: real Node on PATH'; exit 91; }\n`;
      const args = options.unknown ? ['--surprise'] : options.start ? ['--start'] : [];
      result = await run(bash, ['--noprofile', '--norc', '-s', '--', ...args], env, { input: guard + read(file) });
    } else {
      const wanted = options.global ? path.join(toolsDir, 'node.exe') : '';
      const invokeArgs = options.unknown ? ' -Surprise' : options.start ? ' -Start' : options.falseStart ? ' -Start:$false' : '';
      const command = `$c = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1; if (($c -and $c.Source -ne ${psQuote(wanted)}) -or (-not $c -and ${psQuote(wanted)})) { throw 'ISOLATION: real Node on PATH' }\n$beforePath = $env:PATH\ntry { & ([scriptblock]::Create([IO.File]::ReadAllText(${psQuote(file)})))${invokeArgs} } finally { if ($env:VIBEHUB_TOKEN) { throw 'ISOLATION: copied token env not cleared' }; if ($env:PATH -ne $beforePath) { throw 'ISOLATION: PATH changed' } }\nif ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`;
      result = await runPS(command, env);
    }
    if (state.serverError) throw state.serverError;
    for (const name of ['runtime-errors.log', 'curl-errors.log', 'tar-errors.log']) {
      const file = path.join(env.HOME, name);
      if (fs.existsSync(file) && read(file).trim()) result.text += '\nFixture diagnostic (' + name + '):\n' + read(file);
    }
    result.commands = jsonLines(env.VH_TEST_LOG);
    result.audit = jsonLines(env.VH_TEST_AUDIT);
    result.verbs = result.commands.map((args) => args[0]);
    check(!result.text.includes(fakeToken) && !result.text.includes('bad token\nsecret'), 'No secret echo');
    check(!/ISOLATION:/.test(result.text), 'Isolation guards must not be tripped\n' + result.text);
    check(!/^Connected:\s*yes|^OK Connected|^Connected\.?$/mi.test(result.text), 'No connection claim without fresh server heartbeat evidence');
    for (const event of result.audit) { if (event.path) check(inside(event.path), 'All stub reads/writes isolated'); if (event.event === 'runtime') check(event.tokenEnvAbsent, 'No copied token inherited by Node children'); }
    if (!options.lock) check(!fs.existsSync(path.join(base, '.connect.lock')), 'Lock released on success/failure');
    if (fs.existsSync(base)) check(!fs.readdirSync(base).some((name) => /^\.connect\./.test(name) && name !== '.connect.lock'), 'No partial staging artifacts');
    if (options.existing) equal(read(path.join(base, 'tracker.pid')), '42424242\n', 'Synthetic running PID untouched; no real PID used');
    return result;
  };
  return state;
}

async function cases(kind) {
  const prefix = kind + ': ';
  for (const [name, options] of [
    ['absent Node, setup only', {}], ['absent Node, explicit start', { start: true }],
    ['old global Node upgraded privately', { global: 'v16.0.0', start: true }],
    ['healthy global Node reused', { global: 'v22.0.0', start: true }],
    ['healthy private Node reused without global Node', { private: manifest.version, start: true }],
    ['private Node preferred over global', { private: manifest.version, global: 'v22.0.0' }],
    ['old private runtime safely replaced', { private: 'v16.0.0', existing: true, start: true }],
    ['already-running tracker explicit acknowledgement', { private: manifest.version, existing: true, mode: 'already-running', start: true }],
    ['stale cached Connected is not evidence', { private: manifest.version, mode: 'status-stale', start: true }],
    ['CLI output cannot echo copied token', { private: manifest.version, mode: 'secret-output', start: true }],
  ]) await test(prefix + name, async () => {
    const f = fixture(kind, options); const r = await f.invoke();
    if (sampleDir && kind === 'posix' && name === 'absent Node, explicit start') fs.writeFileSync(path.join(sampleDir, 'connect-success-sample.txt'), 'exit code: ' + r.code + '\n\n' + r.text);
    equal(r.code, 0, r.text);
    check(/Done in \d+s\.\s*$/.test(r.text.replace(/\s+$/, '')), 'Elapsed line is the very last output');
    equal(r.verbs, options.start ? ['login', 'start', 'status'] : ['login'], 'Explicit lifecycle contract');
    check(r.text.startsWith('VibeHub\nConnecting this device'), 'Friendly first progress');
    check(r.text.includes('Installed in ~/.vibehub'), 'Installation success after all checks');
    check(r.text.includes('fresh server heartbeat'), 'Success remains distinct from Connected');
    const reuse = options.global === 'v22.0.0' || options.private === manifest.version;
    equal(f.requests.filter((q) => q.kind === 'node').length, reuse ? 0 : 1, 'Correct reuse/download decision');
    check(fs.existsSync(f.bin), 'Installed app exists');
    equal(JSON.parse(read(path.join(f.base, 'config.json'))).apiUrl, origin, 'Selected origin, not a pinned deployment');
    if (!reuse || options.private) check(fs.existsSync(f.runtime), 'Stable private runtime path exists');
    if (options.existing) equal(JSON.parse(read(path.join(f.base, 'config.json'))).projectAliases, { 'fixture-only': 'Alias' }, 'Existing synthetic configuration retained');
  });

  await test(prefix + 'retry is safe; printed start/status/stop work without global Node', async () => {
    const f = fixture(kind); const first = await f.invoke(); equal(first.code, 0, first.text);
    const second = await f.invoke(); equal(second.code, 0, second.text);
    equal(second.verbs, ['login', 'login'], 'Retry is still setup only');
    equal(f.requests.filter((q) => q.kind === 'node').length, 1, 'Retry reuses installed runtime');
    const controls = [...second.text.matchAll(/^  (start|status|stop): (.+)$/gm)]; equal(controls.length, 3, 'Three copyable controls');
    for (const [, verb, command] of controls) {
      const env = { ...f.env, VIBEHUB_TOKEN: '' };
      const r = kind === 'windows' ? await runPS(command + '\nif ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }', env) : await run(bash, ['--noprofile', '--norc', '-c', command], env);
      equal(r.code, 0, 'Quoted control command: ' + verb + '\n' + r.text);
    }
    equal(jsonLines(f.env.VH_TEST_LOG).map((args) => args[0]), ['login', 'login', 'start', 'status', 'stop'], 'Control arguments preserve spaced/apostrophe/dollar paths');
  });

  for (const mode of ['login-reject', 'login-offline', 'start-exit', 'start-zero', 'status-down', 'status-exit', 'status-rejected']) await test(prefix + mode + ' fails closed', async () => {
    const f = fixture(kind, { private: manifest.version, existing: true, mode, start: true }); const r = await f.invoke(); noSuccess(r);
    if (sampleDir && kind === 'posix' && mode === 'login-reject') fs.writeFileSync(path.join(sampleDir, 'connect-failure-sample.txt'), 'exit code: ' + r.code + '\n\n' + r.text);
    if (mode.startsWith('login-')) {
      equal(r.verbs, ['login'], 'No start after failed/unverified login'); check(read(f.bin).startsWith('// Previous synthetic install'), 'Old app retained after login failure');
      check(r.text.includes('Nothing was started.'), 'Truthful pre-start hint present');
      check(!r.text.includes('check its status before retrying'), 'Post-start hint absent before any start attempt');
    }
    else {
      equal(r.verbs, mode.startsWith('start-') ? ['login', 'start'] : ['login', 'start', 'status'], 'Failure occurred at the intended lifecycle stage');
      check(!r.verbs.includes('stop'), 'Wrapper does not clean up by stopping someone else');
      check(r.text.includes('A start was attempted; check its status before retrying.'), 'Truthful post-start hint present, not silently omitted');
      check(!r.text.includes('Nothing was started.'), 'Never claims nothing started once a start was actually attempted');
      if (sampleDir && kind === 'posix' && mode === 'status-rejected') fs.writeFileSync(path.join(sampleDir, 'connect-poststart-failure-sample.txt'), 'exit code: ' + r.code + '\n\n' + r.text);
    }
  });
  for (const [name, options] of [
    ['missing token', { token: '' }], ['malformed token', { token: 'bad token\nsecret' }], ['unknown option', { unknown: true }],
    ['terminal-newline token rejected', { token: fakeToken + '\n' }],
    ['terminal-newline origin rejected', { origin: 'https://example.invalid\n' }],
    ['occupied install lock', { lock: true }],
    ['HTTP remote origin rejected', { origin: 'http://example.invalid' }],
    ['credential URL rejected', { origin: 'https://name:password@example.invalid' }],
    ['path URL rejected', { origin: 'https://example.invalid/path' }],
    ['query URL rejected', { apiOrigin: 'https://example.invalid?secret' }],
    ['fragment URL rejected', { apiOrigin: 'https://example.invalid#x' }],
    ['invalid port rejected', { origin: 'https://example.invalid:65536' }],
    ['invalid hostname rejected', { origin: 'https://bad..example.invalid' }],
    ['untrusted URL scheme rejected', { origin: 'file:///tmp/fixture' }],
  ]) await test(prefix + name, async () => {
    const f = fixture(kind, options); const r = await f.invoke(); noSuccess(r); equal(r.verbs, [], 'No tracker command'); equal(f.requests, [], 'No traffic on invalid input/occupied lock');
  });

  for (const [name, web, api] of [
    ['selected HTTPS deployments', 'https://web.preview.example:444/', 'https://api.preview.example:8443/'],
    ['localhost development', 'http://localhost:43123/', 'http://localhost:43124/'],
    ['IPv6/IPv4 loopback development', 'http://[::1]:43123/', 'http://127.0.0.1:43124/'],
  ]) await test(prefix + 'origin validation unit: ' + name, async () => {
    const f = fixture(kind, { originProbe: true, origin: web, apiOrigin: api }); const r = await f.invoke();
    equal(r.code, 0, r.text);
    check(r.text.includes('ORIGIN_WEB=' + web.replace(/\/$/, '')), 'Supplied web origin preserved');
    check(r.text.includes('ORIGIN_API=' + api.replace(/\/$/, '')), 'Supplied API origin preserved');
    equal(f.requests, [], 'Origin unit probe returns before any traffic');
    equal(r.verbs, [], 'Origin unit probe never runs a tracker command');
  });

  for (const target of ['node', 'bundle', 'verify']) for (const issue of ['status', 'redirect', 'truncate', 'timeout', 'empty', 'oversize']) await test(prefix + target + ' ' + issue, async () => {
    const options = { target, issue, start: true, existing: true, private: target === 'node' ? 'v16.0.0' : manifest.version };
    const f = fixture(kind, options); const previous = fs.readFileSync(f.runtime); const r = await f.invoke(); noSuccess(r);
    check(f.requests.some((request) => request.kind === target), 'Failure reached the intended ' + target + ' transport');
    equal(r.verbs, [], 'Download/verify failures never login/start');
    equal(fs.readFileSync(f.runtime), previous, 'Existing runtime not destroyed by failed download');
    check(read(f.bin).startsWith('// Previous synthetic install'), 'Working app kept on download/verify failure');
    check(!f.requests.some((q) => q.url === '/must-not-follow'), 'No redirects followed');
  });
  for (const promoteFailure of ['license', 'runtime', 'bundle']) await test(prefix + 'atomic promotion failure: ' + promoteFailure, async () => {
    const f = fixture(kind, { promoteFailure, private: promoteFailure === 'bundle' ? manifest.version : 'v16.0.0', existing: true, start: true });
    const previous = fs.readFileSync(f.runtime); const r = await f.invoke(); noSuccess(r);
    equal(read(path.join(f.env.HOME, 'promotion-failure.log')), promoteFailure, 'Reached the intended promotion fault');
    equal(fs.readFileSync(f.runtime), previous, 'A failed upgrade never replaces the previously working runtime');
    check(read(f.bin).startsWith('// Previous synthetic install'), 'Previously installed app preserved');
    equal(r.verbs, promoteFailure === 'bundle' ? ['login'] : [], 'Promotion failure never starts/stops anything');
  });
  for (const [name, options] of [
    ['corrupt Node archive', { target: 'node', issue: 'corrupt' }],
    ['production hash rejects synthetic archive', { productionPins: true }],
    ['unexpected archive layout after correct hash', { badLayout: true }],
    ['verified runtime wrong version', { bootVersion: 'v16.0.0' }],
    ['verified runtime fails to execute', { breakBoot: true }],
  ]) await test(prefix + name, async () => {
    const f = fixture(kind, { ...options, existing: true, private: 'v16.0.0', start: true }); const previous = fs.readFileSync(f.runtime); const r = await f.invoke(); noSuccess(r);
    check(f.requests.some((request) => request.kind === 'node'), 'Reached runtime download before integrity/layout/runtime failure');
    equal(fs.readFileSync(f.runtime), previous, 'Old runtime byte-for-byte intact'); equal(r.verbs, [], 'No tracker execution');
    if (options.productionPins || options.issue === 'corrupt') {
      check(!r.audit.some((event) => event.event === 'runtime' && /[\\/]\.connect\./.test(event.self)), 'Nothing in an unverified archive was executed');
      if (kind === 'posix') check(!fs.existsSync(path.join(f.env.HOME, 'tools.log')), 'Unverified archive never reached tar');
    }
  });
  for (const [target, issue] of [['bundle', 'invalid'], ['verify', 'invalid'], ['verify', 'shape'], ['verify', 'chunked-oversize']]) await test(prefix + target + ' ' + issue, async () => {
    const f = fixture(kind, { target, issue, private: manifest.version, start: true }); const r = await f.invoke(); noSuccess(r); equal(r.verbs, [], 'Invalid payload never reaches CLI');
  });
  await test(prefix + 'integrity and consent negative controls actually trip detectors', async () => {
    const insecure = fixture(kind, { productionPins: true, skipIntegrity: true }); const bypass = await insecure.invoke();
    equal(bypass.code, 0, 'Deliberate test-only integrity mutation should let fake runtime through\n' + bypass.text);
    check(bypass.audit.some((event) => event.event === 'runtime' && /[\\/]\.connect\./.test(event.self)), 'Integrity sentinel is non-vacuous');
    const unwantedStart = fixture(kind, { private: manifest.version, forceStart: true }); const consent = await unwantedStart.invoke();
    check(consent.verbs.includes('start'), 'Consent detector catches a deliberately broken test-only gate');
  });
  if (kind === 'posix') {
    for (const [osName, archName, platform] of [['Linux', 'x86_64', 'linux-x64'], ['Linux', 'aarch64', 'linux-arm64'], ['Darwin', 'x86_64', 'darwin-x64'], ['Darwin', 'arm64', 'darwin-arm64']]) await test(prefix + 'mocked platform selects ' + platform, async () => {
      const f = fixture(kind, { os: osName, arch: archName }); const r = await f.invoke(); equal(r.code, 0, r.text);
      check(f.requests.some((q) => q.url.endsWith('/' + manifest.platforms[platform].file)), 'Correct pinned archive selection');
    });
    for (const options of [{ os: 'MINGW64_NT-10.0' }, { os: 'MSYS_NT-10.0' }, { os: 'CYGWIN_NT-10.0' }, { os: 'FreeBSD' }, { arch: 'i686' }, { arch: 'riscv64' }, { kernel: '5.15.0-microsoft-standard-WSL2' }, { glibc: 'musl' }, { glibc: 'glibc 2.27' }, { kernel: '4.17.0' }, { os: 'Darwin', macVersion: '13.4' }, { noHash: true }]) await test(prefix + 'unsupported prerequisite ' + JSON.stringify(options), async () => {
      const f = fixture(kind, options); const r = await f.invoke(); noSuccess(r); equal(r.verbs, [], 'No tracker execution on unsupported host');
      if (/MINGW|MSYS|CYGWIN/.test(options.os || '') || (options.kernel || '').includes('microsoft')) check(r.text.includes('PowerShell'), 'Honest Windows/WSL guidance');
    });
    if (windows) await test(prefix + 'native Git Bash rejected without Linux bootstrap', async () => {
      const f = fixture(kind, { nativeProbe: true }); const r = await f.invoke(); noSuccess(r); equal(f.requests, [], 'No Node traffic under actual Git Bash'); check(r.text.includes('PowerShell'), 'Right native Windows path');
    });
  } else {
    for (const arch of ['X64', 'Arm64']) await test(prefix + 'mocked OSArchitecture selects ' + arch, async () => {
      const f = fixture(kind, { arch }); const r = await f.invoke(); equal(r.code, 0, r.text); check(f.requests.some((q) => q.url.endsWith('/' + manifest.platforms['win-' + arch.toLowerCase()].file)), 'Correct Windows pinned archive');
    });
    await test(prefix + '32-bit OS rejected and -Start:$false is setup-only', async () => {
      const bad = fixture(kind, { arch: 'X86' }); const r = await bad.invoke(); noSuccess(r); equal(bad.requests, [], 'Never install x64 on a 32-bit OS');
      const good = fixture(kind, { private: manifest.version, falseStart: true }); const s = await good.invoke(); equal(s.code, 0, s.text); equal(s.verbs, ['login'], 'False switch never starts');
    });
  }
}

try {
  await staticTests();
  if (group !== 'static') {
    await new Promise((resolve, reject) => { fixtureServer.once('error', reject); fixtureServer.listen(0, '127.0.0.1', resolve); });
    origin = 'http://127.0.0.1:' + fixtureServer.address().port;
    if (group === 'all' || group === 'posix') {
      await test('prepare isolated Bash tools and syntax parse', async () => { if (!await prepareBash()) return false; await cases('posix'); });
    }
    if (group === 'all' || group === 'windows') {
      await test('prepare native PS5.1 parser and fake PE runtimes', async () => { if (!await preparePowerShell()) return false; await cases('windows'); });
    }
  }
  await test('public/legacy assets remain byte-for-byte untouched by tests', async () => { for (const [file, before] of snapshots) equal(hash(fs.readFileSync(file)), before, file); });
} catch (error) { results.failures++; results.fatal = error.stack; console.error(error.stack); }
finally {
  for (const socket of sockets) socket.destroy();
  if (fixtureServer.listening) await new Promise((resolve) => fixtureServer.close(resolve));
  results.coverage = {
    windows: results.powershell ? 'Native Windows PowerShell + real HTTP/ZIP/hash/rename, synthetic runtime/CLI; ARM64 selection mocked, no official binary execution.' : 'Not executed natively.',
    linux: process.platform === 'linux' && results.bash ? 'Native Bash/curl/tar/filesystem with synthetic runtime/CLI and mocked platform probes; no official binary execution.' : 'No native Linux execution; any Linux selection tests are mocks.',
    macos: process.platform === 'darwin' && results.bash ? 'Native Bash/curl/tar/filesystem with synthetic runtime/CLI and mocked platform probes; no official binary execution.' : 'No native macOS execution; Darwin mocks are NOT native Mac evidence.',
  };
  results.finishedAt = new Date().toISOString();
  results.caseCounts = {
    passed: results.cases.filter((item) => item.status === 'PASS').length,
    failed: results.cases.filter((item) => item.status === 'FAIL').length,
    skipped: results.cases.filter((item) => item.status === 'SKIP').length,
  };
  results.fixtureServerClosed = !fixtureServer.listening;
  results.group = group;
  results.caseMatch = caseMatch;
  if (caseMatch && !results.cases.some((item) => /^(posix|windows): /.test(item.name))) { results.failures++; results.fatal = 'No scenarios matched the requested filter.'; }
  results.fixtureRoot = root;
  results.fixturesRetained = results.failures > 0;
  const file = path.join(output, 'results-' + group + '.json');
  fs.writeFileSync(file, JSON.stringify(results, null, 2) + '\n');
  fs.writeFileSync(path.join(output, 'results-' + group + '.log'), results.cases.map((item) => item.status + ' ' + item.name + (item.error ? '\n' + item.error : '')).join('\n') + '\n');
  if (!results.failures) fs.rmSync(root, { recursive: true, force: true });
  console.log('\n' + results.cases.length + ' cases; ' + results.checks + ' checks; ' + results.failures + ' failures. Results: ' + file);
  for (const skip of results.skips) console.log('NOT COVERED: ' + skip);
  for (const [platform, coverage] of Object.entries(results.coverage)) console.log(platform + ': ' + coverage);
  for (const blocker of results.blockers) console.log('BLOCKED: ' + blocker);
  process.exitCode = results.failures ? 1 : results.blockers.length ? 2 : 0;
}
