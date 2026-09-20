import { globToRegExp } from './glob.js';

/**
 * Turning one line per reference into one entry per package.
 *
 * The interesting question across a set of repositories is not "what do we
 * use" but "how many different answers do we have" — so entries are ordered
 * by how many distinct versions are in play, and the most fragmented package
 * is the first thing printed.
 */

/** A version that is declared somewhere else, under central package management. */
export const INHERITED = '(inherited)';

/** A version written as an MSBuild property, which this tool cannot evaluate. */
export const isProperty = (version) => typeof version === 'string' && version.includes('$(');

export function mergeRows(rows, { filter = null } = {}) {
  const wanted = filter ? globToRegExp(filter) : null;
  const packages = new Map();

  for (const row of rows) {
    if (!row.package) continue;
    if (wanted && !wanted.test(row.package)) continue;

    const entry = packages.get(row.package) ?? { package: row.package, versions: new Map() };
    const version = row.version ?? INHERITED;
    const repos = entry.versions.get(version) ?? new Set();
    repos.add(row.repo);
    entry.versions.set(version, repos);
    packages.set(row.package, entry);
  }

  return [...packages.values()]
    .map((entry) => {
      const versions = [...entry.versions]
        .map(([version, repos]) => ({ version, repos: [...repos].sort() }))
        .sort((a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : 0));
      // A property or an inherited version is not an answer to "which version",
      // so neither counts towards how split the estate is.
      const spread = versions.filter((v) => v.version !== INHERITED && !isProperty(v.version)).length;
      const repos = new Set(versions.flatMap((v) => v.repos));
      return { package: entry.package, spread, repos: repos.size, versions };
    })
    .sort(
      (a, b) =>
        b.spread - a.spread ||
        b.repos - a.repos ||
        (a.package.toLowerCase() < b.package.toLowerCase() ? -1 : 1),
    );
}

/** The report as a person reads it. */
export function formatReport(report) {
  if (report.length === 0) return 'nuls: nothing referenced\n';

  const lines = [];
  for (const entry of report) {
    const split = entry.spread > 1 ? `  — ${entry.spread} versions in use` : '';
    lines.push(`${entry.package}${split}`);
    for (const { version, repos } of entry.versions) {
      lines.push(`    ${version.padEnd(16)} ${repos.join(', ')}`);
    }
  }

  return `${lines.join('\n')}\n`;
}
