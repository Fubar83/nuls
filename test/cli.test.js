import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CENTRAL, CLASSIC, cleanUp, tempDir, writeTree } from './fixtures.js';

after(cleanUp);

const CLI = fileURLToPath(new URL('../bin/nuls.js', import.meta.url));

/** Run the CLI itself, so exit codes and the output split are covered too. */
function nuls(args, { cwd, stdin = '' } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin);
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

  // Silence would be indistinguishable from a failed run once these are merged.
  assert.equal(row.package, null);
  assert.ok(row.repo);
});

test('scans pipe into a merge', async () => {
  const one = await writeTree(await tempDir(), CLASSIC);
  const two = await writeTree(await tempDir(), CENTRAL);

  const scans = [await nuls([], { cwd: one }), await nuls([], { cwd: two })];
  const merged = await nuls(['--merge', '--json'], { stdin: scans.map((s) => s.stdout).join('') });

  const report = JSON.parse(merged.stdout);
  const serilog = report.find((entry) => entry.package === 'Serilog');
  assert.equal(merged.code, 0);
  assert.equal(serilog.spread, 2);
});

test('a line that is not JSON is skipped rather than fatal', async () => {
  const stdin = '==> some stray header\n{"repo":"api","package":"Serilog","version":"3.1.1"}\n';

  const result = await nuls(['--merge'], { stdin });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Serilog/);
  assert.match(result.stderr, /not JSON/);
});

test('an empty filter is an error, not everything', async () => {
  const result = await nuls(['--filter', '']);

  assert.equal(result.code, 2);
  assert.match(result.stderr, /--filter requires a glob/);
});

test('an unknown option is an error', async () => {
  const result = await nuls(['--merg']);

  assert.equal(result.code, 2);
  assert.match(result.stderr, /unknown option '--merg'/);
});
