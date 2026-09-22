import { paletteFor } from './color.js';

/**
 * Exit codes are distinct so a caller can tell a mistyped command line from a
 * command that ran and failed:
 *
 *   0  success
 *   1  runtime / execution failure
 *   2  command-line usage or parsing error
 */
export const EXIT = { SUCCESS: 0, RUNTIME: 1, USAGE: 2 };

/**
 * A bad command line. Thrown during parsing, before any file is read and
 * before standard input is waited on.
 */
export class UsageError extends Error {
  constructor(message, { hint } = {}) {
    super(message);
    this.name = 'UsageError';
    this.exitCode = EXIT.USAGE;
    this.hint = hint;
  }
}

/**
 * Something failed while doing the work. `component` tags which part failed —
 * 'stdin' for the listings piped in, and so on — and appears in the message
 * as `error [stdin]: …`.
 */
export class RuntimeError extends Error {
  constructor(message, { component } = {}) {
    super(message);
    this.name = 'RuntimeError';
    this.exitCode = EXIT.RUNTIME;
    this.component = component;
  }
}

export function formatError(error) {
  const tag = error instanceof RuntimeError && error.component ? ` [${error.component}]` : '';
  return `error${tag}: ${error.message}`;
}

/** Print an error the way the CLI should, and return the exit code to use. */
export function reportError(error) {
  const note = paletteFor(process.stderr);
  process.stderr.write(`${note.red(formatError(error))}\n`);
  if (error instanceof UsageError && error.hint) {
    // The usage that follows is help, not the complaint, so it stays plain.
    process.stderr.write(`\n${error.hint}\n`);
  }
  return error.exitCode ?? EXIT.RUNTIME;
}
