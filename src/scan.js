import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { globToRegExp } from './glob.js';

/**
 * Reading what a repository declares.
 *
 * The project files are read directly: no restore, no SDK, no network. That
 * is the point — a sweep across forty clones should not depend on forty
 * successful restores — but it does mean this reports what the repository
 * *says*, not what NuGet resolves. A version written as an MSBuild property
 * is reported as the property, and transitive dependencies are not here at
 * all. For resolved truth in a repository that restores, ask the SDK:
 * `dotnet list package --include-transitive --format json`.
 */

/** Never worth walking into. */
const SKIP = new Set(['bin', 'obj', 'node_modules', '.git', '.vs', 'packages', 'TestResults']);

const PROJECT = /\.(cs|fs|vb)proj$/i;
const PACKAGES_CONFIG = /^packages\.config$/i;
// Files MSBuild imports on its own, and so the only ones that can be holding a
// version for a project that does not state one.
const VERSION_SOURCE = /^directory\.(packages\.props|build\.props|build\.targets)$/i;

const isInteresting = (name) =>
  PROJECT.test(name) || PACKAGES_CONFIG.test(name) || VERSION_SOURCE.test(name);

/** Every file worth reading under `directory`, walked once. */
export function* projectFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory() || entry.isSymbolicLink()) {
      if (SKIP.has(entry.name)) continue;
      try {
        yield* projectFiles(full);
      } catch {
        // A link pointing nowhere, or a directory we may not read.
      }
    } else if (isInteresting(entry.name)) {
      yield full;
    }
  }
}

const attribute = (tag, name) =>
  tag.match(new RegExp(name + String.raw`\s*=\s*"([^"]*)"`, 'i'))?.[1] ?? null;

/** Strip comments first: a commented-out reference is not a reference. */
const contents = (file) => readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '');

/**
 * The PackageReference and PackageVersion elements one file declares.
 *
 * `held` marks the ones that only carry a version for someone else: a
 * PackageVersion under central package management, or the `Update=` spelling
 * a shared .props file uses to set a version without adding a reference.
 */
function elementsIn(xml) {
  const found = [];
  const element = /<(PackageReference|PackageVersion)\s([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/gi;

  for (const [, name, tag, closing, body] of xml.matchAll(element)) {
    const include = attribute(tag, 'Include');
    const id = include ?? attribute(tag, 'Update');
    if (!id) continue;

    const version =
      attribute(tag, 'VersionOverride') ??
      attribute(tag, 'Version') ??
      (closing === '/>' ? null : (body?.match(/<Version>([^<]*)<\/Version>/i)?.[1]?.trim() ?? null));

    found.push({ package: id, version, held: name === 'PackageVersion' || include === null });
  }

  return found;
}

/**
 * Where a project goes looking for a version it does not state itself.
 *
 * MSBuild imports the nearest Directory.Packages.props walking up from the
 * project, so the nearest one wins here too.
 */
function versionSources(files, root) {
  const byDirectory = new Map();

  for (const file of files) {
    if (!VERSION_SOURCE.test(path.basename(file))) continue;
    const directory = path.dirname(file);
    const versions = byDirectory.get(directory) ?? new Map();
    for (const { package: id, version } of elementsIn(contents(file))) {
      if (version !== null) versions.set(id.toLowerCase(), version);
    }
    byDirectory.set(directory, versions);
  }

  return (projectFile) => {
    // Walk up towards the repository root, nearest first.
    let directory = path.dirname(projectFile);
    while (true) {
      const versions = byDirectory.get(directory);
      if (versions) return versions;
      if (directory === root || path.dirname(directory) === directory) return new Map();
      directory = path.dirname(directory);
    }
  };
}

function packagesConfig(xml) {
  const found = [];
  for (const [, tag] of xml.matchAll(/<(package\s[^>]*?)\/?>/gi)) {
    const id = attribute(tag, 'id');
    if (id) found.push({ package: id, version: attribute(tag, 'version') });
  }
  return found;
}

const relative = (root, file) => path.relative(root, file).split(path.sep).join('/');

/**
 * Every package a repository references, as the project that references it
 * would see it: a version held centrally is resolved onto the project, so a
 * row answers "what is this project on" rather than "what does this file say".
 *
 * A version this tool cannot work out — no version anywhere, or one written
 * as an MSBuild property — is reported as it stands rather than guessed at.
 */
export function scanRepo(directory, { filter = null } = {}) {
  const root = path.resolve(directory);
  const repo = path.basename(root);
  const wanted = filter ? globToRegExp(filter) : null;
  const files = [...projectFiles(root)];
  const sourceFor = versionSources(files, root);
  const rows = [];

  for (const file of files) {
    const name = path.basename(file);
    if (VERSION_SOURCE.test(name)) continue;

    const project = relative(root, file);

    if (PACKAGES_CONFIG.test(name)) {
      for (const found of packagesConfig(contents(file))) {
        if (wanted && !wanted.test(found.package)) continue;
        rows.push({ repo, project, package: found.package, version: found.version });
      }
      continue;
    }

    const central = sourceFor(file);
    for (const found of elementsIn(contents(file))) {
      // A project file can hold a version for another project too; that is
      // not a reference of its own.
      if (found.held) continue;
      if (wanted && !wanted.test(found.package)) continue;
      rows.push({
        repo,
        project,
        package: found.package,
        version: found.version ?? central.get(found.package.toLowerCase()) ?? null,
      });
    }
  }

  return rows.sort(
    (a, b) =>
      (a.project < b.project ? -1 : a.project > b.project ? 1 : 0) ||
      (a.package.toLowerCase() < b.package.toLowerCase() ? -1 : 1),
  );
}
