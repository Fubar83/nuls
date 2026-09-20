#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { formatReport, mergeRows } from '../src/merge.js';
import { scanRepo } from '../src/scan.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const USAGE = `nuls — list the NuGet packages a repository references

Usage:
  nuls [--filter <glob>] [--json]      list this repository's packages
  nuls --merge [--filter <glob>] [--json]
                                       merge those listings into one report

Options:
  --filter <glob>   Only packages whose name matches, e.g. "MyCompany.*"
  --merge           Read listings on standard input and report across them
  --json            Machine-readable output
  --help            Show this help

One line of JSON per reference, each naming the repository it came from, so a
sweep needs no glue:

  repwrk foreach --parallel nuls 2>/dev/null | nuls --merge

repwrk writes its own headers to standard error, which is why the two halves
pipe together cleanly.`;

const EXIT = { SUCCESS: 0, RUNTIME: 1, USAGE: 2 };

function parse(argv) {
  const options = { filter: null, merge: false, json: false, help: false, version: false };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') options.help = true;
    else if (token === '--version' || token === '-V') options.version = true;
    else if (token === '--merge') options.merge = true;
    else if (token === '--json') options.json = true;
    else if (token === '--filter') {
      const value = argv[index + 1];
      // An empty filter would read as "no filter" and widen a report to
      // everything, which is the opposite of what was asked for.
      if (value === undefined || value === '' || value.startsWith('-')) {
        throw usageError('--filter requires a glob');
      }
      options.filter = value;
      index += 1;
    } else if (token.startsWith('--filter=')) {
      const value = token.slice('--filter='.length);
      if (value === '') throw usageError('--filter requires a glob');
      options.filter = value;
    } else {
      throw usageError(
        token.startsWith('-') ? `unknown option '${token}'` : `unexpected argument '${token}'`,
      );
    }
  }

  return options;
}

function usageError(message) {
  const error = new Error(message);
  error.exitCode = EXIT.USAGE;
  return error;
}

function readStdin() {
  process.stdin.setEncoding('utf8');
  let data = '';
  return new Promise((resolve, reject) => {
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

/** Lines that are not JSON are someone's stray output, not a reason to stop. */
function parseLines(input) {
  const rows = [];
  for (const line of input.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      process.stderr.write(`nuls: ignoring a line that is not JSON\n`);
    }
  }
  return rows;
}

async function run(argv) {
  const options = parse(argv);

  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return EXIT.SUCCESS;
  }
  if (options.version) {
    process.stdout.write(`${version}\n`);
    return EXIT.SUCCESS;
  }

  if (options.merge) {
    const report = mergeRows(parseLines(await readStdin()), { filter: options.filter });
    process.stdout.write(
      options.json ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report),
    );
    return EXIT.SUCCESS;
  }

  const directory = process.cwd();
  const rows = scanRepo(directory, { filter: options.filter });

  if (options.json || !process.stdout.isTTY) {
    // A repository with no match still says so, so that "nothing here" is
    // data rather than silence when these lines are merged.
    if (rows.length === 0) {
      process.stdout.write(`${JSON.stringify({ repo: path.basename(directory), package: null })}\n`);
    }
    for (const row of rows) process.stdout.write(`${JSON.stringify(row)}\n`);
    return EXIT.SUCCESS;
  }

  // At a terminal, a person is reading.
  if (rows.length === 0) {
    process.stderr.write('nuls: no package references here\n');
    return EXIT.SUCCESS;
  }
  for (const row of rows) {
    process.stdout.write(`${(row.version ?? '(inherited)').padEnd(16)} ${row.package}\n`);
  }
  return EXIT.SUCCESS;
}

process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(process.exitCode ?? EXIT.SUCCESS);
  process.stderr.write(`error: ${error.message}\n`);
  process.exit(EXIT.RUNTIME);
});

try {
  process.exitCode = await run(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`error: ${error.message}\n`);
  process.exitCode = error.exitCode ?? EXIT.RUNTIME;
}
