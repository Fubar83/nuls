import { globToRegExp } from './glob.js';

/**
 * Reading a sweep of many repositories as one thing.
 *
 * Two ways to look at the same rows:
 *
 *   by package  what versions of this are in play, and who is on each — the
 *               question that only exists once there is more than one
 *               repository, and the reason to merge at all
 *   by project  the rows as a tree, for reading an estate rather than
 *               interrogating it
 */

/** A reference whose version nothing declares. */
export const NO_VERSION = '(no version found)';

/**
 * A version left as an MSBuild property, which only --files produces: it is a
 * name for a version, not a version, so it cannot tell you two repositories
 * disagree.
 */
export const isProperty = (version) => version.includes('$(');

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byName = (a, b) => compare(a.toLowerCase(), b.toLowerCase());

const wanted = (filter) => {
  if (!filter) return () => true;
  const pattern = globToRegExp(filter);
  return (row) => pattern.test(row.package);
};

/** Rows worth reporting: a repository that matched nothing still said so. */
const references = (rows, filter) => rows.filter((row) => row.package && wanted(filter)(row));

/**
 * One entry per package: which versions are in use, and which repositories
 * are on each.
 *
 * `spread` counts the versions actually declared — a reference nothing
 * declares a version for is not a version anyone chose, so it does not make a
 * package look more fragmented than it is.
 */
export function byPackage(rows, { filter = null } = {}) {
  const packages = new Map();

  for (const row of references(rows, filter)) {
    const entry = packages.get(row.package) ?? { package: row.package, versions: new Map() };
    const version = row.version ?? NO_VERSION;
    const where = entry.versions.get(version) ?? new Map();
    const projects = where.get(row.repo) ?? new Set();
    projects.add(row.project);
    where.set(row.repo, projects);
    entry.versions.set(version, where);
    packages.set(row.package, entry);
  }

  return [...packages.values()]
    .map((entry) => {
      const versions = [...entry.versions]
        .map(([version, where]) => ({
          version,
          repos: [...where.keys()].sort(byName),
          projects: [...where].flatMap(([repo, paths]) =>
            [...paths].sort(byName).map((project) => `${repo}/${project}`),
          ),
        }))
        .sort((a, b) => compare(a.version, b.version));

      const repos = new Set(versions.flatMap((one) => one.repos));
      return {
        package: entry.package,
        spread: versions.filter((one) => one.version !== NO_VERSION && !isProperty(one.version))
          .length,
        repos: repos.size,
        versions,
      };
    })
    .sort((a, b) => b.spread - a.spread || b.repos - a.repos || byName(a.package, b.package));
}

/** The same rows as a tree: repository, then project, then packages. */
export function byProject(rows, { filter = null } = {}) {
  const repos = new Map();

  for (const row of references(rows, filter)) {
    const projects = repos.get(row.repo) ?? new Map();
    const packages = projects.get(row.project) ?? [];
    packages.push({ package: row.package, version: row.version });
    projects.set(row.project, packages);
    repos.set(row.repo, projects);
  }

  return [...repos]
    .map(([repo, projects]) => ({
      repo,
      projects: [...projects]
        .map(([project, packages]) => ({
          project,
          packages: packages.sort((a, b) => byName(a.package, b.package)),
        }))
        .sort((a, b) => byName(a.project, b.project)),
    }))
    .sort((a, b) => byName(a.repo, b.repo));
}

const WIDTH = 44;

export function formatByPackage(report) {
  if (report.length === 0) return 'nuls: nothing referenced\n';

  const lines = [];
  for (const entry of report) {
    const split = entry.spread > 1 ? `  — ${entry.spread} versions in use` : '';
    lines.push(`${entry.package}${split}`);
    for (const { version, repos } of entry.versions) {
      lines.push(`  ${version.padEnd(18)} ${repos.join(', ')}`);
    }
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

export function formatByProject(report) {
  if (report.length === 0) return 'nuls: nothing referenced\n';

  const lines = [];
  for (const { repo, projects } of report) {
    lines.push(repo);
    for (const { project, packages } of projects) {
      lines.push(`  ${project}`);
      for (const one of packages) {
        lines.push(`    ${one.package.padEnd(WIDTH)} ${one.version ?? NO_VERSION}`);
      }
    }
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}
