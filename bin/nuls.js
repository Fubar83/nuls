#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  byPackage,
  byProject,
  formatByPackage,
  formatByProject,
} from '../src/merge.js';
import { paletteFor } from '../src/color.js';
import { scanRepo } from '../src/scan.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const USAGE = `nuls — list the NuGet packages a repository references

Usage:
  nuls [--filter <glob>] [--json] [--files]
  nuls --merge [--by package|project] [--filter <glob>] [--json]

Options:
  -f, --filter <glob>   Only packages whose name matches, e.g. "MyCompany.*"
  -j, --json            Machine-readable output
      --files           Read the project files instead of asking MSBuild:
                        faster, but a version written as a property stays a
                        property. No one-letter form: -f is --filter's.
  -m, --merge           Read listings on standard input and report across them
  -b, --by <view>       What a merged report is grouped by:
                          package  which versions are in use, and who is on
                                   each (the default)
                          project  repository, then project, then its packages
  -h, --help            Show this help

Reads the repository in the current directory: no SDK, no restore, no network.
A version held in Directory.Packages.props is resolved onto the project that
references it, so every line says what that project is on.

Piped or redirected, every line is JSON and names the repository it came
from, so a sweep across many repositories needs no glue:

  repwrk foreach --parallel nuls | nuls --merge

repwrk writes its own headers to standard error, so only the packages reach
the pipe.`;

const EXIT = { SUCCESS: 0, RUNTIME: 1, USAGE: 2 };

/** Data goes to stdout and commentary to stderr, each coloured on its own terms. */
const ink = paletteFor(process.stdout);
const note = paletteFor(process.stderr);

function usageError(message) {
  const error = new Error(message);
  error.exitCode = EXIT.USAGE;
  return error;
}

/**
 * One-letter forms.
 *
 * `--files` deliberately has none: -f is --filter's, and the two are easy to
 * reach for by the same instinct. A wrong guess between them would quietly
 * change which engine answered rather than failing, and a report that is
 * subtly different is worse than one that did not run.
 */
const SHORT = { '-f': '--filter', '-j': '--json', '-m': '--merge', '-b': '--by' };

function parse(argv) {
  const options = {
    filter: null,
    json: false,
    files: false,
    merge: false,
    by: 'package',
    help: false,
    version: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    // A short form stands in for its long one, but any complaint names the
    // spelling that was actually typed.
    const typed = argv[index].includes('=')
      ? argv[index].slice(0, argv[index].indexOf('='))
      : argv[index];
    const token = SHORT[typed] ? SHORT[typed] + argv[index].slice(typed.length) : argv[index];

    if (token === '--help' || token === '-h') {
      options.help = true;
    } else if (token === '--version' || token === '-V') {
      options.version = true;
    } else if (token === '--json') {
      options.json = true;
    } else if (token === '--files') {
      options.files = true;
    } else if (token === '--merge') {
      options.merge = true;
    } else if (token === '--by') {
      const value = argv[index + 1];
      if (value !== 'package' && value !== 'project') {
        throw usageError(`${typed} takes 'package' or 'project'`);
      }
      options.by = value;
      index += 1;
    } else if (token === '--filter') {
      const value = argv[index + 1];
      // An empty filter would read as "no filter" and widen the listing to
      // everything, which is the opposite of what was asked for.
      if (value === undefined || value === '' || value.startsWith('-')) {
        throw usageError(`${typed} requires a glob`);
      }
      options.filter = value;
      index += 1;
    } else if (token.startsWith('--filter=')) {
      const value = token.slice('--filter='.length);
      if (value === '') throw usageError(`${typed} requires a glob`);
      options.filter = value;
    } else {
      throw usageError(
        token.startsWith('-') ? `unknown option '${token}'` : `unexpected argument '${token}'`,
      );
    }
  }

  return options;
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

/** A line that is not JSON is someone's stray output, not a reason to stop. */
function parseLines(input) {
  const rows = [];
  let ignored = 0;

  for (const line of input.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      ignored += 1;
    }
  }

  if (ignored > 0) {
    process.stderr.write(`${note.yellow(`nuls: ignored ${ignored} line(s) that were not JSON`)}\n`);
  }

  return rows;
}

async function merge(options) {
  const rows = parseLines(await readStdin());
  const view = options.by === 'project' ? byProject : byPackage;
  const report = view(rows, { filter: options.filter });

  process.stdout.write(
    options.json
      ? `${JSON.stringify(report, null, 2)}\n`
      : (options.by === 'project' ? formatByProject : formatByPackage)(report),
  );

  return EXIT.SUCCESS;
}

/** At a terminal, under the project that references them. */
function printGrouped(rows) {
  let project = null;
  for (const row of rows) {
    if (row.project !== project) {
      if (project !== null) process.stdout.write('\n');
      process.stdout.write(`${ink.grey(row.project)}\n`);
      project = row.project;
    }
    // Dot leaders rather than spaces: these lists get long, and the eye needs
    // something to follow from a package name to the version beside it.
    const dots = '.'.repeat(Math.max(2, 41 - row.package.length));
    const version = row.version ?? '(no version found)';
    process.stdout.write(
      `  ${ink.bold(row.package)} ${ink.dim(dots)} ` +
        `${row.version === null ? ink.yellow(version) : version}\n`,
    );
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

  if (options.merge) return merge(options);

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
    process.stderr.write(`${note.dim('nuls: no package references here')}\n`);
    return EXIT.SUCCESS;
  }
  printGrouped(rows);
  return EXIT.SUCCESS;
}

// Piping into `head` and friends closes stdout early; that is not an error.
process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(process.exitCode ?? EXIT.SUCCESS);
  process.stderr.write(`${note.red(`error: ${error.message}`)}\n`);
  process.exit(EXIT.RUNTIME);
});

try {
  process.exitCode = await run(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`error: ${error.message}\n`);
  process.exitCode = error.exitCode ?? EXIT.RUNTIME;
}
