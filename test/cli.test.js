import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CENTRAL, CLASSIC, cleanUp, tempDir, writeTree } from './fixtures.js';

after(cleanUp);

const CLI = fileURLToPath(new URL('../bin/nuls.js', import.meta.url));

/** Run the CLI itself, so exit codes and the output split are covered too. */
function nuls(args, { cwd } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

const lines = (stdout) => stdout.split('\n').filter(Boolean).map((line) => JSON.parse(line));

test('a scan writes one JSON line per reference, and nothing else to stdout', async () => {
  const repo = await writeTree(await tempDir(), CLASSIC);

  const result = await nuls([], { cwd: repo });

  assert.equal(result.code, 0);
  const rows = lines(result.stdout);
  assert.ok(rows.some((row) => row.package === 'Serilog' && row.version === '3.1.1'));
  assert.ok(rows.every((row) => row.repo));
});

test('a repository with nothing to report still says which repository it is', async () => {
  const repo = await tempDir();

  const [row] = lines((await nuls([], { cwd: repo })).stdout);

  // Silence and a failed run look identical once these lines are read together.
  assert.equal(row.package, null);
  assert.ok(row.repo);
});

test('scans from several repositories concatenate into one stream', async () => {
  const one = await writeTree(await tempDir(), CLASSIC);
  const two = await writeTree(await tempDir(), CENTRAL);

  const stream = (await nuls([], { cwd: one })).stdout + (await nuls([], { cwd: two })).stdout;

  // Whatever reads this needs no framing: every line stands on its own.
  const rows = lines(stream);
  assert.equal(new Set(rows.map((row) => row.repo)).size, 2);
  assert.ok(rows.every((row) => row.repo && 'package' in row));
});

test('a filter narrows the listing', async () => {
  const repo = await writeTree(await tempDir(), CENTRAL);

  const rows = lines((await nuls(['--filter', 'MyCompany.*'], { cwd: repo })).stdout);

  assert.ok(rows.length > 0);
  assert.ok(rows.every((row) => row.package.startsWith('MyCompany.')));
});

test('an empty filter is an error, not everything', async () => {
  const result = await nuls(['--filter', '']);

  assert.equal(result.code, 2);
  assert.match(result.stderr, /--filter requires a glob/);
});

test('an unknown option is an error', async () => {
  const result = await nuls(['--merge']);

  assert.equal(result.code, 2);
  assert.match(result.stderr, /unknown option '--merge'/);
});
