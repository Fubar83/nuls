import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CENTRAL, CLASSIC, cleanUp, tempDir, writeTree } from './fixtures.js';

after(cleanUp);

const CLI = fileURLToPath(new URL('../bin/nuls.js', import.meta.url));

/** Run the CLI itself, so exit codes and the output split are covered too. */
function nuls(args, { cwd, stdin = null } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd,
      stdio: [stdin === null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    if (stdin !== null) child.stdin.end(stdin);
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
  assert.ok(rows.every((row) => row.repo && row.project));
  // kind was noise: every row already says which project it belongs to.
  assert.ok(rows.every((row) => !('kind' in row)));
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
  assert.match(result.stderr, /--filter requires a value/);
});

test('an unknown option is an error', async () => {
  const result = await nuls(['--merg']);

  assert.equal(result.code, 2);
  assert.match(result.stderr, /unknown option '--merg'/);
});

test('scans from several repositories merge into one report', async () => {
  const one = await writeTree(await tempDir(), CLASSIC);
  const two = await writeTree(await tempDir(), CENTRAL);

  const scans =
    (await nuls(['--files'], { cwd: one })).stdout + (await nuls(['--files'], { cwd: two })).stdout;
  const merged = await nuls(['--merge', '--json'], { stdin: scans });

  const report = JSON.parse(merged.stdout);
  const serilog = report.find((entry) => entry.package === 'Serilog');
  assert.equal(merged.code, 0);
  assert.equal(serilog.versionsInUse, 2);
});

test('--by project gives the other view of the same rows', async () => {
  const repo = await writeTree(await tempDir(), CLASSIC);

  const scan = (await nuls(['--files'], { cwd: repo })).stdout;
  const merged = await nuls(['--merge', '--by', 'project', '--json'], { stdin: scan });

  const [entry] = JSON.parse(merged.stdout);
  assert.equal(entry.projects[0].project, 'src/Api/Api.csproj');
  assert.ok(entry.projects[0].packages.some((one) => one.package === 'Serilog'));
});

test('a line that is not JSON is skipped rather than fatal', async () => {
  const stdin = '==> a stray header\n{"repo":"api","project":"a.csproj","package":"Serilog","version":"3.1.1"}\n';

  const result = await nuls(['--merge'], { stdin });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Serilog/);
  assert.match(result.stderr, /not JSON/);
});

test('--by only takes the two views it has', async () => {
  const result = await nuls(['--merge', '--by', 'repo'], { stdin: '' });

  assert.equal(result.code, 2);
  assert.match(result.stderr, /--by takes/);
});

// Short forms

test('the one-letter forms mean the same as the long ones', async () => {
  const repo = await writeTree(await tempDir(), CLASSIC);

  const short = await nuls(['-f', 'Seri*', '-j'], { cwd: repo });
  const long = await nuls(['--filter', 'Seri*', '--json'], { cwd: repo });

  assert.equal(short.code, 0);
  assert.equal(short.stdout, long.stdout);
  assert.match(short.stdout, /Serilog/);
  assert.ok(!short.stdout.includes('Polly'), 'the filter applied');
});

test('-m and -b group a merged report the way the long forms do', async () => {
  const listing = [
    JSON.stringify({ repo: 'a', project: 'A.csproj', package: 'Serilog', version: '3.1.1' }),
    JSON.stringify({ repo: 'b', project: 'B.csproj', package: 'Serilog', version: '4.0.0' }),
  ].join('\n');

  const short = await nuls(['-m', '-b', 'project'], { stdin: listing });
  const long = await nuls(['--merge', '--by', 'project'], { stdin: listing });

  assert.equal(short.code, 0);
  assert.equal(short.stdout, long.stdout);
});

// -f is --filter's, and a wrong guess between the two would quietly change
// which engine answered rather than failing.
test('--files has no one-letter form', async () => {
  const repo = await writeTree(await tempDir(), CLASSIC);
  const result = await nuls(['-F'], { cwd: repo });

  assert.equal(result.code, 2);
  assert.match(result.stderr, /unknown option '-F'/);
});

test('an error names the form that was actually typed', async () => {
  const bare = await nuls(['-f']);
  assert.equal(bare.code, 2);
  assert.match(bare.stderr, /-f requires a value/);

  const by = await nuls(['-b', 'nonsense']);
  assert.equal(by.code, 2);
  assert.match(by.stderr, /-b takes 'package' or 'project'/);
});

test('an inline value works with a one-letter form too', async () => {
  const repo = await writeTree(await tempDir(), CLASSIC);
  const result = await nuls(['-f=Seri*', '--json'], { cwd: repo });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Serilog/);
  assert.ok(!result.stdout.includes('Polly'));
});

// The other two tools print the usage block after a usage error; nuls used to
// print the complaint alone.
test('a usage error is followed by the usage, as in the sibling tools', async () => {
  const result = await nuls(['--nope']);

  assert.equal(result.code, 2);
  assert.match(result.stderr, /unknown option '--nope'/);
  assert.match(result.stderr, /Usage:/, 'the usage block follows the complaint');
  assert.match(result.stderr, /nuls \[-f\|--filter <glob>\]/);
});

test('a runtime failure names the part that failed', async () => {
  const { RuntimeError, formatError } = await import('../src/errors.js');
  assert.equal(
    formatError(new RuntimeError('broken pipe', { component: 'stdin' })),
    'error [stdin]: broken pipe',
  );
});
