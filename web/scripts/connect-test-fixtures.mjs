// Synthetic fixtures only. Never load the real tracker, AI files or an official Node archive.
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

export const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const shQuote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
export const psQuote = (value) => `'${String(value).replaceAll("'", "''")}'`;

function tarMember(name, content) {
  const body = Buffer.from(content);
  const header = Buffer.alloc(512);
  header.write(name, 0, 100);
  header.write('0000700\0', 100, 8);
  header.write('0000000\0', 108, 8);
  header.write('0000000\0', 116, 8);
  header.write(body.length.toString(8).padStart(11, '0') + '\0', 124, 12);
  header.write('00000000000\0', 136, 12);
  header.fill(32, 148, 156);
  header.write('0', 156, 1);
  header.write('ustar\0', 257, 6);
  header.write('00', 263, 2);
  const sum = header.reduce((total, byte) => total + byte, 0);
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return Buffer.concat([header, body, Buffer.alloc((512 - body.length % 512) % 512)]);
}

export function tarFixture(name, runtime, { layout = true } = {}) {
  return gzipSync(Buffer.concat([
    tarMember(`${name}/${layout ? 'bin/node' : 'wrong-node'}`, runtime),
    tarMember(`${name}/LICENSE`, 'Synthetic test license. Not a Node distribution.\n'),
    Buffer.alloc(1024),
  ]));
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function zipFixture(name, runtime, { layout = true } = {}) {
  const local = []; const central = []; let offset = 0;
  for (const [path, content] of [
    [`${name}/${layout ? 'node.exe' : 'wrong-node.exe'}`, runtime],
    [`${name}/LICENSE`, Buffer.from('Synthetic test license. Not a Node distribution.\n')],
  ]) {
    const file = Buffer.from(path); const body = Buffer.from(content); const crc = crc32(body);
    const record = Buffer.alloc(30);
    record.writeUInt32LE(0x04034b50, 0); record.writeUInt16LE(20, 4);
    record.writeUInt32LE(crc, 14); record.writeUInt32LE(body.length, 18); record.writeUInt32LE(body.length, 22);
    record.writeUInt16LE(file.length, 26);
    local.push(record, file, body);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
    directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(body.length, 20); directory.writeUInt32LE(body.length, 24);
    directory.writeUInt16LE(file.length, 28); directory.writeUInt32LE(offset, 42);
    central.push(directory, file); offset += record.length + file.length + body.length;
  }
  const directory = Buffer.concat(central); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(2, 8); end.writeUInt16LE(2, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

// This driver is run by the test's EXISTING host Node executable, not by a fetched
// runtime. The downloaded "Node" is a tiny fake shell/PE launcher for this driver.
// Everything below runs only after both the parent and the launcher check isolation.
export const driverSource = String.raw`'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
// Git Bash may pass /c/... literally to the native host Node. Convert only that
// path syntax before native path.resolve/read calls; the same root guards apply.
const hostPath = (value) => process.platform === 'win32' ? value.replace(/^\/([a-z])\//i, (_, drive) => drive + ':/') : value;
const [version, self, ...args] = process.argv.slice(2).map(hostPath);
const normalize = (s) => String(s || '').replace(/\\/g, '/').replace(/^\/([a-z])\//i, (_, c) => c + ':/').replace(/\/$/, '').toLowerCase();
const root = normalize(process.env.VH_TEST_ROOT);
const home = normalize(process.env.VH_TEST_HOME);
const within = (s, base) => normalize(s).startsWith(base + '/');
if (!root || !within(home, root) || normalize(os.homedir()) !== home || !within(self, root)) throw Error('ISOLATION: home/runtime escaped');
for (const key of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'TMPDIR', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'QUADCODE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME']) {
  if (normalize(process.env[key]) !== home && !within(process.env[key], home)) throw Error('ISOLATION: ' + key);
}
if (normalize((process.env.HOMEDRIVE || '') + (process.env.HOMEPATH || '')) !== home) throw Error('ISOLATION: drive/home');
if (process.env.VIBEHUB_TOKEN) throw Error('ISOLATION: token env reached a runtime child');
const originalRead = fs.readFileSync.bind(fs);
const originalWrite = fs.writeFileSync.bind(fs);
if (originalRead(path.join(process.env.VH_TEST_HOME, '.sandbox-marker'), 'utf8') !== 'VIBEHUB CONNECT SYNTHETIC ONLY') throw Error('ISOLATION: no marker');
const record = (event) => originalWrite(process.env.VH_TEST_AUDIT, JSON.stringify(event) + '\n', { flag: 'a' });
const guard = (target) => {
  if (typeof target !== 'string' || !within(path.resolve(target), root)) throw Error('ISOLATION: file outside test root');
};
fs.readFileSync = (file, ...rest) => { guard(file); record({ event: 'read', path: file }); return originalRead(file, ...rest); };
for (const key of ['writeFileSync', 'appendFileSync', 'mkdirSync', 'renameSync', 'unlinkSync', 'rmSync']) {
  const original = fs[key].bind(fs);
  fs[key] = (target, ...rest) => { guard(target); if (key === 'renameSync') guard(rest[0]); record({ event: 'write', path: target }); return original(target, ...rest); };
}
const deny = () => { throw Error('ISOLATION: forbidden network/child process'); };
for (const id of ['node:child_process', 'node:http', 'node:https', 'node:net', 'node:dgram']) {
  const module = require(id);
  for (const key of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork', 'request', 'get', 'connect', 'createConnection', 'createServer', 'createSocket']) if (key in module) module[key] = deny;
}
global.fetch = deny;
Date.now = () => 1700000000000;
record({ event: 'runtime', self, version, args, tokenEnvAbsent: !process.env.VIBEHUB_TOKEN });
if (args[0] === '--version') {
  if (process.env.VH_BREAK_BOOT === '1' && /[\\/]\.connect\./.test(self)) process.exit(13);
  console.log(version); process.exit(0);
}
if (args[0] === '--check') {
  guard(args[1]);
  try { new vm.Script(fs.readFileSync(args[1], 'utf8')); process.exit(0); } catch { process.exit(1); }
}
if (args[0] === '-e') {
  if (!args[1].startsWith('/* vibehub-connect-verify */')) throw Error('ISOLATION: unknown eval');
  guard(args[2]);
  vm.runInNewContext(args[1], {
    require: (id) => { if (id !== 'node:fs') return deny(); return { readFileSync: (file, encoding) => { if (file !== args[2]) return deny(); return fs.readFileSync(file, encoding); } }; },
    // Forwarded to the driver's own real stdout: the sandbox restricts file/network
    // access, not text output, and the eval'd probe legitimately prints its result.
    process: { argv: ['node', args[2]], exit: (code) => process.exit(code), stdout: { write: (chunk) => process.stdout.write(String(chunk)) } },
  });
  process.exit(0);
}
guard(args[0]);
if (!fs.readFileSync(args[0], 'utf8').startsWith('// VIBEHUB CONNECT TEST STUB')) throw Error('ISOLATION: refusing any real tracker');
process.argv = [process.execPath, args[0], ...args.slice(1)];
require(args[0]);
`;

export const trackerSource = `// VIBEHUB CONNECT TEST STUB - no network, polling, process creation or real credentials.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const home = process.env.VH_TEST_HOME;
const mode = process.env.VH_TRACKER_MODE || 'ok';
const argv = process.argv.slice(2);
fs.appendFileSync(process.env.VH_TEST_LOG, JSON.stringify(argv) + '\\n');
const verb = argv[0];
if (verb === 'login') {
  if (mode === 'login-reject') { console.error('Login failed: rejected (stub).'); process.exit(1); }
  const file = path.join(home, '.vibehub', 'config.json');
  const previous = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  fs.writeFileSync(file, JSON.stringify({ ...previous, deviceToken: argv[1], apiUrl: argv[3] }));
  if (mode === 'login-offline') console.log('Could not verify with the server right now - saved anyway.');
  else console.log('Logged in as @synthetic.');
  if (mode === 'secret-output') console.log(argv[1]);
} else if (verb === 'start') {
  if (mode === 'start-exit') { console.error('Failed to start tracker daemon.'); process.exit(7); }
  if (mode === 'start-zero') { console.error('Failed to start tracker daemon.'); process.exit(0); }
  console.log(mode === 'already-running' ? 'Tracker is already running (pid 4242).' : 'Tracker started (pid 4242).');
} else if (verb === 'status') {
  if (mode === 'status-exit') process.exit(5);
  console.log(mode === 'status-down' ? 'Daemon:  not running' : 'Daemon:  running (pid 4242)');
  console.log(mode === 'status-rejected' ? 'Connected: no - token rejected by the server.' : mode === 'status-stale' ? 'Connected: yes' : 'Connected: not yet - waiting for the first heartbeat.');
} else if (verb === 'stop') console.log('Synthetic stop acknowledged. No process existed.');
else { console.error('Forbidden stub verb'); process.exit(98); }
// ${'padding '.repeat(160)}
`;

// A fake native executable, compiled with the already-installed .NET compiler.
// It launches only the guarded fixture driver with the host Node used by this test.
// It never launches the real tracker, downloads code, or changes machine settings.
export function fakeRuntimeCSharp(version) {
  if (!/^v\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid fixture version');
  return `using System;
using System.IO;
using System.Diagnostics;
using System.Text;
public static class ConnectFakeRuntime {
  static string Quote(string value) {
    var result = new StringBuilder("\\\""); int slash = 0;
    foreach (char c in value) {
      if (c == '\\\\') { slash++; continue; }
      if (c == '"') result.Append('\\\\', slash * 2 + 1);
      else result.Append('\\\\', slash);
      result.Append(c); slash = 0;
    }
    result.Append('\\\\', slash * 2); result.Append('"'); return result.ToString();
  }
  public static int Main(string[] args) {
    string root = Environment.GetEnvironmentVariable("VH_TEST_ROOT");
    string home = Environment.GetEnvironmentVariable("VH_TEST_HOME");
    string driver = Environment.GetEnvironmentVariable("VH_NODE_DRIVER");
    string node = Environment.GetEnvironmentVariable("VH_REAL_NODE");
    string self = System.Reflection.Assembly.GetExecutingAssembly().Location;
    if (String.IsNullOrEmpty(root) || String.IsNullOrEmpty(home) || String.IsNullOrEmpty(driver) || String.IsNullOrEmpty(node)) return 91;
    if (!Path.GetFullPath(home).StartsWith(Path.GetFullPath(root) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) return 91;
    if (!Path.GetFullPath(driver).StartsWith(Path.GetFullPath(root) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) return 91;
    if (!Path.GetFullPath(self).StartsWith(Path.GetFullPath(root) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) return 91;
    if (File.ReadAllText(Path.Combine(home, ".sandbox-marker")) != "VIBEHUB CONNECT SYNTHETIC ONLY") return 91;
    var line = new StringBuilder(Quote(driver) + " " + Quote("${version}") + " " + Quote(self));
    foreach (string arg in args) line.Append(" " + Quote(arg));
    var info = new ProcessStartInfo(node, line.ToString());
    info.UseShellExecute = false; info.CreateNoWindow = true;
    using (var child = Process.Start(info)) { child.WaitForExit(); return child.ExitCode; }
  }
}
`;
}
