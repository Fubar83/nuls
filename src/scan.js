import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { globToRegExp } from './glob.js';

/**
 * Reading what a repository declares.
 *
 * The project files are read directly: no restore, no SDK, no network. That
 * is the whole point — a sweep across forty clones should not depend on forty
 * successful restores — but it does mean this reports what the repository
 * *says*, not what NuGet resolves. A version written as an MSBuild property
 * is reported as the property, and transitive dependencies are not here at
 * all. For resolved truth in a repository that restores, ask the SDK:
 * `dotnet list package --include-transitive --format json`.
 */

/** Never worth walking into. */
const SKIP = new Set(['bin', 'obj', 'node_modules', '.git', '.vs', 'packages', 'TestResults']);

const PROJECT = /\.(cs|fs|vb)proj$/i;
const BUILD_FILE = /\.(props|targets)$/i;
const PACKAGES_CONFIG = /^packages\.config$/i;

const isInteresting = (name) =>
  PROJECT.test(name) || BUILD_FILE.test(name) || PACKAGES_CONFIG.test(name);

/** Every file worth reading under `directory`, walked once. */
export function* projectFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory() || entry.isSymbolicLink()) {
      if (SKIP.has(entry.name)) continue;
      try {
        yield* projectFiles(full);
      } catch {
        // A link pointing nowhere, or a directory we may not read: not this
        // tool's business to complain about.
      }
    } else if (isInteresting(entry.name)) {
      yield full;
    }
  }
}

const attribute = (tag, name) =>
  tag.match(new RegExp(name + String.raw`\s*=\s*"([^"]*)"`, 'i'))?.[1] ?? null;

/**
 * The package references one file declares.
 *
 * `kind` says which spelling it was, because that is what tells you where a
 * version can be changed: 'central' is Directory.Packages.props under central
 * package management, 'reference' is a project's own PackageReference, and
 * 'packages.config' is the pre-SDK format.
 */
export function readProjectFile(file) {
  // Comments first: a commented-out reference is not a reference.
  const xml = readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const found = [];

  for (const [, tag] of xml.matchAll(/<(package\s[^>]*?)\/?>/gi)) {
    const id = attribute(tag, 'id');
    if (id) found.push({ package: id, version: attribute(tag, 'version'), kind: 'packages.config' });
  }

  // Self-closing or not; the version may be an attribute or a child element.
  const element = /<(PackageReference|PackageVersion)\s([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/gi;
  for (const [, name, tag, closing, body] of xml.matchAll(element)) {
    // Update= is how a .props file sets a version for a reference declared
    // elsewhere, so it names a package just as Include= does.
    const id = attribute(tag, 'Include') ?? attribute(tag, 'Update');
    if (!id) continue;

    const version =
      attribute(tag, 'VersionOverride') ??
      attribute(tag, 'Version') ??
      (closing === '/>' ? null : (body?.match(/<Version>([^<]*)<\/Version>/i)?.[1]?.trim() ?? null));

    found.push({ package: id, version, kind: name === 'PackageVersion' ? 'central' : 'reference' });
  }

  return found;
}

/**
 * Every package reference in one repository, in package order.
 *
 * `repo` is the directory's own name, so a row says where it came from with
 * no help from whatever ran it.
 */
export function scanRepo(directory, { filter = null } = {}) {
  const repo = path.basename(path.resolve(directory));
  const wanted = filter ? globToRegExp(filter) : null;
  const rows = [];

  for (const file of projectFiles(directory)) {
    for (const found of readProjectFile(file)) {
      if (wanted && !wanted.test(found.package)) continue;
      rows.push({
        repo,
        file: path.relative(directory, file).split(path.sep).join('/'),
        ...found,
      });
    }
  }

  return rows.sort(
    (a, b) =>
      (a.package.toLowerCase() < b.package.toLowerCase() ? -1 : a.package.toLowerCase() > b.package.toLowerCase() ? 1 : 0) ||
      (a.file < b.file ? -1 : a.file > b.file ? 1 : 0),
  );
}
