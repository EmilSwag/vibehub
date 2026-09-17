// Narrow byte guard for fresh connector endpoints. Does not run any connector.
// Default: check only. Explicit --write: normalize only these two owned assets.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
assert(args.length === 0 || (args.length === 1 && args[0] === '--write'), 'Use --write or no arguments');
for (const name of ['connect.sh', 'connect.ps1']) {
  const file = fileURLToPath(new URL('../public/tracker/' + name, import.meta.url));
  const before = fs.readFileSync(file, 'utf8');
  const after = before.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  assert(!/[^\x00-\x7F]/.test(after), name + ' must remain ASCII for old shells');
  if (args[0] === '--write' && before !== after) fs.writeFileSync(file, after, 'utf8');
  else assert.equal(before, after, name + ' needs LF/no BOM normalization');
  console.log(name + ': LF, ASCII, no BOM');
}
