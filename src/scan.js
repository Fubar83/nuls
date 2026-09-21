import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { globToRegExp } from './glob.js';
import { referencesIn } from './msbuild.js';

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

/**
 * Never worth walking into — the floor for a directory git knows nothing
 * about. Inside a repository these are not needed: a repository that ignores
 * its build output has already said so, and one that tracks a directory called
 * `packages` meant it.
 */
const SKIP = new Set(['bin', 'obj', 'node_modules', '.git', '.vs', 'packages', 'TestResults']);

const PROJECT = /\.(cs|fs|vb)proj$/i;
const PACKAGES_CONFIG = /^packages\.config$/i;
// Files MSBuild imports on its own, and so the only ones that can be holding a
// version for a project that does not state one.
const VERSION_SOURCE = /^directory\.(packages\.props|build\.props|build\.targets)$/i;

const isInteresting = (name) =>
  PROJECT.test(name) || PACKAGES_CONFIG.test(name) || VERSION_SOURCE.test(name);

/**
 * The paths git considers part of the repository: tracked files, plus
 * untracked ones that are not ignored.
 *
 * Asking git rather than walking is what makes a repository's own ignore rules
 * apply. A project under a gitignored path is not something the repository
 * declares — it is build output, a restored package, or somebody's scratch
 * copy — and reporting its references as the repository's own is wrong. Which
 * paths those are is the repository's statement to make, not this tool's.
 *
 * It is also much the faster of the two on a large repository, because an
 * ignored directory is never descended into at all rather than walked and
 * discarded.
 *
 * Returns null when this is not a repository, or git is not installed. Both
 * are ordinary — nuls reads a directory, and a directory need not be a clone —
 * and the filesystem walk answers for them.
 */
function gitPaths(directory) {
  const listed = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: directory,
    encoding: 'utf8',
    // A very large repository's file list; the default 1MB truncates silently.
    maxBuffer: 256 * 1024 * 1024,
  });

  if (listed.error || listed.status !== 0) return null;
  return listed.stdout.split('\0').filter(Boolean);
}

/** Every file worth reading under `directory`, walked once. */
function* walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory() || entry.isSymbolicLink()) {
      if (SKIP.has(entry.name)) continue;
      try {
        yield* walk(full);
      } catch {
        // A link pointing nowhere, or a directory we may not read.
      }
    } else if (isInteresting(entry.name)) {
      yield full;
    }
  }
}

/** Every file worth reading under `directory`, as the repository sees them. */
export function* projectFiles(directory) {
  const listed = gitPaths(directory);
  if (listed === null) {
    yield* walk(directory);
    return;
  }

  for (const file of listed) {
    // git spells every path with forward slashes, on every platform.
    if (!isInteresting(file.slice(file.lastIndexOf('/') + 1))) continue;

    const full = path.join(directory, file);
    // --cached lists a tracked file that has been deleted from the working
    // tree. There is nothing there to read.
    if (existsSync(full)) yield full;
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
 * Reading the project files, for when MSBuild is not asked.
 *
 * MSBuild looks for Directory.Packages.props and Directory.Build.props
 * independently, so they are searched independently here: a Directory.Build.props
 * in between must not hide the central versions above it, which is exactly how a
 * repository with a tests/Directory.Build.props ends up reporting no versions at
 * all for its test projects.
 *
 * A Directory.Build.props may also carry references of its own — the usual way
 * every test project gets xunit without repeating itself. Those belong to each
 * project below it, so they are added to every one of them. Chaining up to the
 * parent is the convention, so every ancestor counts, not only the nearest.
 */
function readFromFiles(files, root) {
  const central = new Map();
  const build = new Map();
  const inherited = new Map();

  for (const file of files) {
    const name = path.basename(file);
    if (!VERSION_SOURCE.test(name)) continue;

    const directory = path.dirname(file);
    const isCentral = /packages\.props$/i.test(name);
    const versions = (isCentral ? central : build).get(directory) ?? new Map();
    const references = inherited.get(directory) ?? [];

    for (const found of elementsIn(contents(file))) {
      if (found.version !== null) versions.set(found.package.toLowerCase(), found.version);
      // An Include in a shared file is a reference every project below gets.
      if (!found.held) references.push(found);
    }

    (isCentral ? central : build).set(directory, versions);
    if (references.length > 0) inherited.set(directory, references);
  }

  /** Walk up from a project, nearest first, and hand back what each level holds. */
  const ancestors = function* (projectFile) {
    let directory = path.dirname(projectFile);
    while (true) {
      yield directory;
      if (directory === root || path.dirname(directory) === directory) return;
      directory = path.dirname(directory);
    }
  };

  const nearestIn = (map, projectFile) => {
    for (const directory of ancestors(projectFile)) {
      const found = map.get(directory);
      if (found) return found;
    }
    return new Map();
  };

  return (projectFile) => {
    const versions = new Map([
      ...nearestIn(build, projectFile),
      // Central package management is the more specific answer of the two.
      ...nearestIn(central, projectFile),
    ]);

    const own = elementsIn(contents(projectFile)).filter((found) => !found.held);
    const fromAbove = [...ancestors(projectFile)].flatMap(
      (directory) => inherited.get(directory) ?? [],
    );

    const rows = new Map();
    for (const found of [...own, ...fromAbove]) {
      const version = found.version ?? versions.get(found.package.toLowerCase()) ?? null;
      // A project stating its own version beats one it inherits.
      if (!rows.has(found.package.toLowerCase())) {
        rows.set(found.package.toLowerCase(), { package: found.package, version });
      }
    }

    return [...rows.values()];
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

/** Run `work` over `items`, a few at a time. */
async function pooled(items, limit, work) {
  const results = new Array(items.length);
  let next = 0;

  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await work(items[index]);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

/** How many projects to evaluate at once. */
const CONCURRENCY = 4;

/**
 * Every package a repository references, as the project that references it
 * would see it.
 *
 * MSBuild is asked first: it evaluates properties and follows the import
 * chain, which reading the files cannot do. A project it will not load falls
 * back to reading, so one broken file does not leave a hole in a sweep —
 * `onProblem` is told when that happens.
 *
 * `engine: 'files'` skips MSBuild entirely, which is faster and answers
 * without a .NET SDK, at the cost of unevaluated properties.
 */
export async function scanRepo(directory, { filter = null, engine = 'msbuild', onProblem } = {}) {
  const root = path.resolve(directory);
  const repo = path.basename(root);
  const wanted = filter ? globToRegExp(filter) : null;
  const files = [...projectFiles(root)];
  const fromFiles = readFromFiles(files, root);
  const keep = (found) => !wanted || wanted.test(found.package);

  const projects = files.filter(
    (file) => !VERSION_SOURCE.test(path.basename(file)) && !PACKAGES_CONFIG.test(path.basename(file)),
  );

  const evaluated =
    engine === 'files'
      ? projects.map(() => null)
      : await pooled(projects, CONCURRENCY, (file) => referencesIn(file));

  const rows = [];

  projects.forEach((file, index) => {
    const project = relative(root, file);
    let found = evaluated[index];

    if (found === null && engine !== 'files') {
      onProblem?.(`${project}: MSBuild could not load it; read as a file instead`);
    }
    found ??= fromFiles(file);

    for (const one of found) {
      if (!keep(one)) continue;
      rows.push({ repo, project, package: one.package, version: one.version });
    }
  });

  // Nothing evaluates packages.config: it is a list of versions, not a build.
  for (const file of files) {
    if (!PACKAGES_CONFIG.test(path.basename(file))) continue;
    for (const found of packagesConfig(contents(file))) {
      if (!keep(found)) continue;
      rows.push({ repo, project: relative(root, file), package: found.package, version: found.version });
    }
  }

  return rows.sort(
    (a, b) =>
      (a.project < b.project ? -1 : a.project > b.project ? 1 : 0) ||
      (a.package.toLowerCase() < b.package.toLowerCase() ? -1 : 1),
  );
}
