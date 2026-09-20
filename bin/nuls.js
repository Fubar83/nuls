#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { scanRepo } from '../src/scan.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const USAGE = `nuls — list the NuGet packages a repository references

Usage:
  nuls [--filter <glob>] [--json]

Options:
  --filter <glob>   Only packages whose name matches, e.g. "MyCompany.*"
  --json            One JSON object per line, even at a terminal
  --help            Show this help

Reads the repository in the current directory: no SDK, no restore, no network.

Piped or redirected, every line is JSON and names the repository it came
from, so a sweep across many repositories needs no glue:

  repwrk foreach --parallel nuls > inventory.ndjson

repwrk writes its own headers to standard error, so only the packages reach
the file.`;

const EXIT = { SUCCESS: 0, RUNTIME: 1, USAGE: 2 };

function usageError(message) {
  const error = new Error(message);
  error.exitCode = EXIT.USAGE;
  return error;
}

function parse(argv) {
  const options = { filter: null, json: false, help: false, version: false };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--help' || token === '-h') {
      options.help = true;
    } else if (token === '--version' || token === '-V') {
      options.version = true;
    } else if (token === '--json') {
      options.json = true;
    } else if (token === '--filter') {
      const value = argv[index + 1];
      // An empty filter would read as "no filter" and widen the listing to
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

function run(argv) {
  const options = parse(argv);

  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return EXIT.SUCCESS;
  }
  if (options.version) {
    process.stdout.write(`${version}\n`);
    return EXIT.SUCCESS;
  }

  const directory = process.cwd();
  const rows = scanRepo(directory, { filter: options.filter });

  if (options.json || !process.stdout.isTTY) {
    // A repository with no match still says so: once these lines are read
    // together, silence and a failed run look identical.
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

// Piping into `head` and friends closes stdout early; that is not an error.
process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(process.exitCode ?? EXIT.SUCCESS);
  process.stderr.write(`error: ${error.message}\n`);
  process.exit(EXIT.RUNTIME);
});

try {
  process.exitCode = run(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`error: ${error.message}\n`);
  process.exitCode = error.exitCode ?? EXIT.RUNTIME;
}
