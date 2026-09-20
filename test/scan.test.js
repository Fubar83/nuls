import assert from 'node:assert/strict';
import path from 'node:path';
import { after, test } from 'node:test';
import { scanRepo } from '../src/scan.js';
import { CENTRAL, CLASSIC, LEGACY, NESTED, UPDATED, cleanUp, tempDir, writeTree } from './fixtures.js';

after(cleanUp);

const versionOf = (rows, name, project = null) =>
  rows.find((row) => row.package === name && (project === null || row.project === project))?.version;

test('a classic project reference is found, attribute or child element', async () => {
  const repo = await writeTree(await tempDir(), CLASSIC);

  const rows = await scanRepo(repo, { engine: 'files' });

  assert.equal(versionOf(rows, 'Serilog'), '3.1.1');
  assert.equal(versionOf(rows, 'Polly'), '7.2.4');
});

test('a commented-out reference is not a reference', async () => {
  const repo = await writeTree(await tempDir(), CLASSIC);

  assert.ok(!(await scanRepo(repo, { engine: 'files' })).some((row) => row.package === 'Newtonsoft.Json'));
});

test('obj and bin are never walked into', async () => {
  const repo = await writeTree(await tempDir(), CLASSIC);

  assert.ok(!(await scanRepo(repo, { engine: 'files' })).some((row) => row.package === 'Ghost'));
});

test('a version written as an MSBuild property is reported as written', async () => {
  const repo = await writeTree(await tempDir(), CLASSIC);

  // Evaluating it would mean being MSBuild; saying so is the honest answer.
  assert.equal(versionOf(await scanRepo(repo, { engine: 'files' }), 'MyCompany.Core'), '$(CoreVersion)');
});

test('a version held centrally is resolved onto the project that references it', async () => {
  const repo = await writeTree(await tempDir(), CENTRAL);

  const rows = await scanRepo(repo, { engine: 'files' });

  // The csproj says which package, Directory.Packages.props says which
  // version; a row is only useful once those two are put together.
  assert.equal(versionOf(rows, 'Serilog', 'src/Web/Web.csproj'), '4.2.0');
  assert.ok(rows.every((row) => row.version !== null));
});

test('a central declaration is not itself a reference', async () => {
  const repo = await writeTree(await tempDir(), CENTRAL);

  // Nothing is attributed to Directory.Packages.props; it holds versions for
  // projects rather than referencing anything.
  assert.ok((await scanRepo(repo, { engine: 'files' })).every((row) => row.project.endsWith('.csproj')));
});

test('VersionOverride beats the central version', async () => {
  const repo = await writeTree(await tempDir(), CENTRAL);

  assert.equal(versionOf(await scanRepo(repo, { engine: 'files' }), 'MyCompany.Core', 'src/Web/Web.csproj'), '2.3.0');
});

test('the nearest Directory.Packages.props is the one that counts', async () => {
  const repo = await writeTree(await tempDir(), NESTED);

  const rows = await scanRepo(repo, { engine: 'files' });

  // MSBuild imports the nearest one walking up, and so does this.
  assert.equal(versionOf(rows, 'Serilog', 'src/Near/Near.csproj'), '2.0.0');
  assert.equal(versionOf(rows, 'Serilog', 'far/Far.csproj'), '1.0.0');
});

test('a version set by Update= in a shared file is resolved too', async () => {
  const repo = await writeTree(await tempDir(), UPDATED);

  assert.equal(versionOf(await scanRepo(repo, { engine: 'files' }), 'Serilog'), '3.0.0');
});

test('packages.config is read too', async () => {
  const repo = await writeTree(await tempDir(), LEGACY);

  assert.equal(versionOf(await scanRepo(repo, { engine: 'files' }), 'Newtonsoft.Json'), '11.0.2');
});

test('a row names the repository and the project it came from', async () => {
  const repo = await writeTree(await tempDir(), CLASSIC);

  const [row] = await scanRepo(repo, { engine: 'files' });
  assert.equal(row.repo, path.basename(repo));
  assert.equal(row.project, 'src/Api/Api.csproj');
});

test('a reference with no version anywhere is reported as having none', async () => {
  const repo = await writeTree(await tempDir(), {
    'App/App.csproj': '<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><PackageReference Include="Orphan" /></ItemGroup></Project>',
  });

  // Guessing would be worse than saying so.
  assert.equal(versionOf(await scanRepo(repo, { engine: 'files' }), 'Orphan'), null);
});

test('a filter narrows to one family of packages', async () => {
  const repo = await writeTree(await tempDir(), CENTRAL);

  const rows = await scanRepo(repo, { engine: 'files', filter: 'MyCompany.*' });

  assert.ok(rows.length > 0);
  assert.ok(rows.every((row) => row.package.startsWith('MyCompany.')));
});
