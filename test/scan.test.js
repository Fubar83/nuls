import assert from 'node:assert/strict';
import path from 'node:path';
import { after, test } from 'node:test';
import { scanRepo } from '../src/scan.js';
import { CENTRAL, CLASSIC, LEGACY, cleanUp, tempDir, writeTree } from './fixtures.js';

after(cleanUp);

const named = (rows) => rows.map((row) => `${row.package}@${row.version ?? '-'}`);

test('a classic project reference is found, attribute or child element', async () => {
  const repo = await writeTree(await tempDir(), CLASSIC);

  const rows = scanRepo(repo);

  assert.ok(named(rows).includes('Serilog@3.1.1'), 'attribute form');
  assert.ok(named(rows).includes('Polly@7.2.4'), 'child element form');
});

test('a commented-out reference is not a reference', async () => {
  const repo = await writeTree(await tempDir(), CLASSIC);

  assert.ok(!scanRepo(repo).some((row) => row.package === 'Newtonsoft.Json'));
});

test('obj and bin are never walked into', async () => {
  const repo = await writeTree(await tempDir(), CLASSIC);

  assert.ok(!scanRepo(repo).some((row) => row.package === 'Ghost'));
});

test('a version written as an MSBuild property is reported as written', async () => {
  const repo = await writeTree(await tempDir(), CLASSIC);

  const core = scanRepo(repo).find((row) => row.package === 'MyCompany.Core');
  // Evaluating it would mean being MSBuild; saying so is the honest answer.
  assert.equal(core.version, '$(CoreVersion)');
});

test('central package management is reported with the file that decides', async () => {
  const repo = await writeTree(await tempDir(), CENTRAL);

  const rows = scanRepo(repo);
  const central = rows.find((row) => row.kind === 'central' && row.package === 'Serilog');
  assert.equal(central.version, '4.2.0');
  assert.equal(central.file, 'Directory.Packages.props');

  // The project's own reference carries no version under CPM.
  const inherited = rows.find((row) => row.kind === 'reference' && row.package === 'Serilog');
  assert.equal(inherited.version, null);
});

test('VersionOverride beats the central version', async () => {
  const repo = await writeTree(await tempDir(), CENTRAL);

  const override = scanRepo(repo).find(
    (row) => row.package === 'MyCompany.Core' && row.kind === 'reference',
  );
  assert.equal(override.version, '2.3.0');
});

test('packages.config is read too', async () => {
  const repo = await writeTree(await tempDir(), LEGACY);

  assert.deepEqual(named(scanRepo(repo)), ['Newtonsoft.Json@11.0.2']);
});

test('a row names the repository it came from', async () => {
  const repo = await writeTree(await tempDir(), LEGACY);

  assert.equal(scanRepo(repo)[0].repo, path.basename(repo));
});

test('a filter narrows to one family of packages', async () => {
  const repo = await writeTree(await tempDir(), CENTRAL);

  const rows = scanRepo(repo, { filter: 'MyCompany.*' });
  assert.ok(rows.length > 0);
  assert.ok(rows.every((row) => row.package.startsWith('MyCompany.')));
});
