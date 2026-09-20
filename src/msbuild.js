import { spawn } from 'node:child_process';

/**
 * Asking MSBuild what a project references.
 *
 * `dotnet msbuild -getItem` evaluates a project without restoring it, which
 * is the whole reason to prefer it: the SDK's own answer, with properties
 * expanded and the import chain followed, at no more cost than reading the
 * files ourselves.
 *
 * Two things it does not do, which is why this file is not the whole tool:
 *
 *   - Central package management is applied during restore, not evaluation,
 *     so a PackageReference under CPM comes back with no version and the
 *     PackageVersion items come back separately. Putting the two together is
 *     still ours to do.
 *   - Evaluating a multi-targeted project without naming a framework is the
 *     outer build, where $(TargetFramework) is empty — so a reference
 *     conditioned on one is simply absent. Each framework is asked for in
 *     turn instead.
 */

/** What MSBuild is asked for; one call answers all of it. */
const ITEMS = 'PackageReference,PackageVersion';
const PROPERTIES = 'TargetFramework,TargetFrameworks';

function runDotnet(args) {
  return new Promise((resolve) => {
    // -nodeReuse:false so a sweep does not leave build nodes behind on the
    // machine that ran it.
    const child = spawn('dotnet', ['msbuild', ...args, '-nologo', '-nodeReuse:false'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => resolve({ code: 1, stdout: '', stderr: error.message }));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/**
 * One evaluation. Returns null when MSBuild could not load the project —
 * a malformed file reports its error as text rather than JSON.
 */
async function evaluate(projectFile, framework = null) {
  const args = [projectFile, `-getItem:${ITEMS}`, `-getProperty:${PROPERTIES}`];
  if (framework) args.push(`-p:TargetFramework=${framework}`);

  const { stdout } = await runDotnet(args);
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

const itemsOf = (result, name) => result?.Items?.[name] ?? [];

/** The frameworks a project builds for, in the order it names them. */
function frameworksOf(result) {
  const several = (result?.Properties?.TargetFrameworks ?? '')
    .split(';')
    .map((name) => name.trim())
    .filter(Boolean);
  return several.length > 1 ? several : [];
}

/**
 * Every package reference a project declares, as MSBuild sees it.
 *
 * Returns null when the project could not be evaluated, so the caller can
 * decide what to do about it rather than being handed an empty answer that
 * looks like "references nothing".
 */
export async function referencesIn(projectFile) {
  const outer = await evaluate(projectFile);
  if (outer === null) return null;

  const central = new Map();
  for (const item of itemsOf(outer, 'PackageVersion')) {
    if (item.Version) central.set(item.Identity.toLowerCase(), item.Version);
  }

  const found = new Map();
  const add = (item) => {
    const version = item.VersionOverride || item.Version || central.get(item.Identity.toLowerCase()) || null;
    // The same package at the same version in two frameworks is one answer.
    found.set(`${item.Identity.toLowerCase()}@${version ?? ''}`, {
      package: item.Identity,
      version,
    });
  };

  for (const item of itemsOf(outer, 'PackageReference')) add(item);

  // A multi-targeted project hides its conditional references from the outer
  // build, so ask again for each framework it names.
  for (const framework of frameworksOf(outer)) {
    const inner = await evaluate(projectFile, framework);
    for (const item of itemsOf(inner, 'PackageReference')) add(item);
  }

  return [...found.values()];
}

/** Whether `dotnet` can be reached at all. */
export async function dotnetAvailable() {
  const { code } = await runDotnet(['-version']);
  return code === 0;
}
