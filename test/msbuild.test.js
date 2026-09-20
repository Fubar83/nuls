import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { scanRepo } from '../src/scan.js';
import { dotnetAvailable } from '../src/msbuild.js';
import { cleanUp, tempDir, writeTree } from './fixtures.js';

after(cleanUp);

// The SDK is assumed where this tool is used, but a test machine is not the
// same thing as a developer's machine.
const available = await dotnetAvailable();

const versionOf = (rows, name) => rows.find((row) => row.package === name)?.version;

describe('asking MSBuild', { skip: !available && 'no dotnet on PATH' }, () => {
  test('a version written as a property is evaluated', async () => {
    const repo = await writeTree(await tempDir(), {
      'App/App.csproj': [
        '<Project Sdk="Microsoft.NET.Sdk">',
        '  <PropertyGroup><TargetFramework>net8.0</TargetFramework><Pinned>3.1.1</Pinned></PropertyGroup>',
        '  <ItemGroup><PackageReference Include="Serilog" Version="$(Pinned)" /></ItemGroup>',
        '</Project>',
      ].join('\n'),
    });

    // This is the whole reason to prefer MSBuild over reading the file.
    assert.equal(versionOf(await scanRepo(repo), 'Serilog'), '3.1.1');
  });

  test('a version held centrally is resolved onto the project', async () => {
    const repo = await writeTree(await tempDir(), {
      'Directory.Packages.props': [
        '<Project>',
        '  <PropertyGroup><ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally></PropertyGroup>',
        '  <ItemGroup><PackageVersion Include="Serilog" Version="4.2.0" /></ItemGroup>',
        '</Project>',
      ].join('\n'),
      'src/App/App.csproj': [
        '<Project Sdk="Microsoft.NET.Sdk">',
        '  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>',
        '  <ItemGroup><PackageReference Include="Serilog" /></ItemGroup>',
        '</Project>',
      ].join('\n'),
    });

    // Central package management is applied during restore, not evaluation,
    // so MSBuild hands back the two halves and this is still our join.
    assert.equal(versionOf(await scanRepo(repo), 'Serilog'), '4.2.0');
  });

  test('a reference conditioned on one target framework is still found', async () => {
    const repo = await writeTree(await tempDir(), {
      'App/App.csproj': [
        '<Project Sdk="Microsoft.NET.Sdk">',
        '  <PropertyGroup><TargetFrameworks>net8.0;net9.0</TargetFrameworks></PropertyGroup>',
        '  <ItemGroup>',
        '    <PackageReference Include="Always" Version="1.0.0" />',
        '    <PackageReference Include="OnlyNet8" Version="2.0.0" Condition="\'$(TargetFramework)\' == \'net8.0\'" />',
        '  </ItemGroup>',
        '</Project>',
      ].join('\n'),
    });

    // The outer build has no TargetFramework, so this one only appears when
    // each framework is asked for in turn.
    assert.equal(versionOf(await scanRepo(repo), 'OnlyNet8'), '2.0.0');
  });

  test('a project MSBuild will not load is read as a file, and said so', async () => {
    const repo = await writeTree(await tempDir(), {
      'App/App.csproj': '<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><PackageReference Include="Half" Version="1.0.0"/>',
    });

    const problems = [];
    const rows = await scanRepo(repo, { onProblem: (message) => problems.push(message) });

    // One unparseable file should not leave a hole in a sweep.
    assert.equal(versionOf(rows, 'Half'), '1.0.0');
    assert.equal(problems.length, 1);
    assert.match(problems[0], /could not load/);
  });
});
