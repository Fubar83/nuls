import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { after, test } from 'node:test';
import { scanRepo } from '../src/scan.js';
import { cleanUp, gitAvailable, gitTree, tempDir, writeTree } from './fixtures.js';

after(cleanUp);

const skip = gitAvailable() ? false : 'git is not installed';

/** A project file declaring one package, so a test can name what it expects. */
const project = (name, id) =>
  `<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><PackageReference Include="${id}" Version="1.0.0" /></ItemGroup></Project>`;

const packages = async (repo) =>
  (await scanRepo(repo, { engine: 'files' })).map((row) => row.package).sort();

test('a project under an ignored path is not what the repository declares', { skip }, async () => {
  const repo = await gitTree({
    '.gitignore': 'vendor/\nartifacts/\n',
    'src/Api/Api.csproj': project('Api', 'Serilog'),
    'vendor/Copied/Copied.csproj': project('Copied', 'GhostFromVendor'),
    'artifacts/Built/Built.csproj': project('Built', 'GhostFromArtifacts'),
  });

  assert.deepEqual(await packages(repo), ['Serilog']);
});

// `artifacts` is not a name this tool has ever known about. Before it asked
// git, only a fixed list of directories was skipped, so anything a repository
// ignored under a name of its own was read and reported as its own.
test('an ignored directory this tool has no opinion about is still ignored', { skip }, async () => {
  const repo = await gitTree({
    '.gitignore': '_build/\n',
    'Api.csproj': project('Api', 'Serilog'),
    '_build/Generated/Generated.csproj': project('Generated', 'Ghost'),
  });

  assert.deepEqual(await packages(repo), ['Serilog']);
});

// The other half of deferring to the repository: a directory on this tool's
// skip list, which the repository tracks and therefore meant.
test('a tracked directory named packages is scanned, not skipped', { skip }, async () => {
  const repo = await gitTree(
    {
      'packages/Core/Core.csproj': project('Core', 'Serilog'),
      'packages/Web/Web.csproj': project('Web', 'Polly'),
    },
    { commit: true },
  );

  assert.deepEqual(await packages(repo), ['Polly', 'Serilog']);
});

test('build output is skipped because the repository ignores it', { skip }, async () => {
  const repo = await gitTree({
    '.gitignore': 'bin/\nobj/\n',
    'Api.csproj': project('Api', 'Serilog'),
    'obj/project.assets.csproj': project('Assets', 'Ghost'),
  });

  assert.deepEqual(await packages(repo), ['Serilog']);
});

test('a new project nobody has committed yet is still part of the repository', { skip }, async () => {
  const repo = await gitTree(
    { 'Api/Api.csproj': project('Api', 'Serilog') },
    { commit: true },
  );
  await writeTree(repo, { 'New/New.csproj': project('New', 'Polly') });

  assert.deepEqual(await packages(repo), ['Polly', 'Serilog']);
});

// git lists a tracked file that has been deleted from the working tree; there
// is nothing there to read, and trying would throw rather than report.
test('a tracked project deleted from the working tree is passed over', { skip }, async () => {
  const repo = await gitTree(
    {
      'Api/Api.csproj': project('Api', 'Serilog'),
      'Gone/Gone.csproj': project('Gone', 'Polly'),
    },
    { commit: true },
  );
  await rm(path.join(repo, 'Gone', 'Gone.csproj'));

  assert.deepEqual(await packages(repo), ['Serilog']);
});

// nuls reads a directory, and a directory need not be a clone. Without git
// there are no ignore rules to apply, so the fixed skip list is the floor.
test('a directory that is not a repository is still walked', async () => {
  const plain = await writeTree(await tempDir(), {
    'Api.csproj': project('Api', 'Serilog'),
    'obj/project.assets.csproj': project('Assets', 'Ghost'),
  });

  assert.deepEqual(await packages(plain), ['Serilog']);
});

test('a .gitignore outside a repository is not read as one', async () => {
  const plain = await writeTree(await tempDir(), {
    '.gitignore': 'vendor/\n',
    'Api.csproj': project('Api', 'Serilog'),
    'vendor/Copied/Copied.csproj': project('Copied', 'Vendored'),
  });

  // Applying ignore rules is git's job, and git is not here to do it.
  assert.deepEqual(await packages(plain), ['Serilog', 'Vendored']);
});
