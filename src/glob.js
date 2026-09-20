/**
 * Shell-style glob matching for package names, with the same rules repwrk
 * uses for repository names: `*` and `?`, anchored, case-insensitive. So
 * `MyCompany.*` matches `MyCompany.Core` but not `Contrib.MyCompany.Core`.
 */

// Written as a set of characters rather than a regex literal so the escaping
// is plain to read.
const REGEXP_SPECIAL = new Set([...'.*+?^${}()|[]', String.fromCharCode(92)]);
const BACKSLASH = String.fromCharCode(92);

export function globToRegExp(pattern) {
  let source = '';
  for (const char of pattern) {
    if (char === '*') source += '.*';
    else if (char === '?') source += '.';
    else source += (REGEXP_SPECIAL.has(char) ? BACKSLASH : '') + char;
  }
  return new RegExp(`^${source}$`, 'i');
}

export function matches(value, pattern) {
  return globToRegExp(pattern).test(value);
}
