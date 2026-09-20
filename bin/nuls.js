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
  --files           Read the project files instead of asking MSBuild: faster,
                    but a version written as a property stays a property
  --help            Show this help

Reads the repository in the current directory: no SDK, no restore, no network.
A version held in Directory.Packages.props is resolved onto the project that
references it, so every line says what that project is on.

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
  const options = { filter: null, json: false, files: false, help: false, version: false };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--help' || token === '-h') {
      options.help = true;
    } else if (token === '--version' || token === '-V') {
      options.version = true;
    } else if (token === '--json') {
      options.json = true;
    } else if (token === '--files') {
      options.files = true;
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

/** At a terminal, under the project that references them. */
function printGrouped(rows) {
  let project = null;
  for (const row of rows) {
    if (row.project !== project) {
      if (project !== null) process.stdout.write('\n');
      process.stdout.write(`${row.project}\n`);
      project = row.project;
    }
    process.stdout.write(`  ${row.package.padEnd(40)} ${row.version ?? '(no version found)'}\n`);
  }
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

  const directory = process.cwd();
  const rows = await scanRepo(directory, {
    filter: options.filter,
    engine: options.files ? 'files' : 'msbuild',
    // A project MSBuild will not load is worth saying out loud, but it is
    // not a reason to fail: the rest of the repository still answers.
    onProblem: (message) => process.stderr.write(`nuls: ${message}
`),
  });

  if (options.json || !process.stdout.isTTY) {
    // One line per reference rather than one per project: each line stands on
    // its own, which is what lets a sweep concatenate without any framing.
    // A repository with no match still says so, so that "nothing here" is
    // data rather than silence.
    if (rows.length === 0) {
      process.stdout.write(`${JSON.stringify({ repo: path.basename(directory), package: null })}\n`);
    }
    for (const row of rows) process.stdout.write(`${JSON.stringify(row)}\n`);
    return EXIT.SUCCESS;
  }

  if (rows.length === 0) {
    process.stderr.write('nuls: no package references here\n');
    return EXIT.SUCCESS;
  }
  printGrouped(rows);
  return EXIT.SUCCESS;
}

// Piping into `head` and friends closes stdout early; that is not an error.
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
