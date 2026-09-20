import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const created = [];

export async function cleanUp() {
  await Promise.all(created.map((dir) => rm(dir, { recursive: true, force: true })));
}

export async function tempDir() {
  const dir = await mkdtemp(path.join(tmpdir(), 'nuls-tests-'));
  created.push(dir);
  return dir;
}

/** Write a layout of files, creating the directories they need. */
export async function writeTree(root, files) {
  for (const [file, contents] of Object.entries(files)) {
    const full = path.join(root, file);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, contents);
  }
  return root;
}

/** A project that spells versions the classic way, plus the awkward cases. */
export const CLASSIC = {
  'src/Api/Api.csproj': [
    '<Project Sdk="Microsoft.NET.Sdk">',
    '  <ItemGroup>',
    '    <PackageReference Include="Serilog" Version="3.1.1" />',
    '    <PackageReference Include="Polly">',
    '      <Version>7.2.4</Version>',
    '    </PackageReference>',
    '    <!-- <PackageReference Include="Newtonsoft.Json" Version="12.0.1" /> -->',
    '    <PackageReference Include="MyCompany.Core" Version="$(CoreVersion)" />',
    '  </ItemGroup>',
    '</Project>',
  ].join('\n'),
  // Never walked into, however tempting the file name.
  'src/Api/obj/project.assets.csproj': '<Project><ItemGroup><PackageReference Include="Ghost" Version="9.9.9" /></ItemGroup></Project>',
};

/** Central package management, with one project overriding the central version. */
export const CENTRAL = {
  'Directory.Packages.props': [
    '<Project>',
    '  <ItemGroup>',
    '    <PackageVersion Include="Serilog" Version="4.2.0" />',
    '    <PackageVersion Include="MyCompany.Core" Version="2.4.1" />',
    '  </ItemGroup>',
    '</Project>',
  ].join('\n'),
  'src/Web/Web.csproj': [
    '<Project Sdk="Microsoft.NET.Sdk">',
    '  <ItemGroup>',
    '    <PackageReference Include="Serilog" />',
    '    <PackageReference Include="MyCompany.Core" VersionOverride="2.3.0" />',
    '  </ItemGroup>',
    '</Project>',
  ].join('\n'),
};

/** The pre-SDK format, which is still out there. */
export const LEGACY = {
  'App/packages.config': [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<packages>',
    '  <package id="Newtonsoft.Json" version="11.0.2" targetFramework="net472" />',
    '</packages>',
  ].join('\n'),
};

/** Two Directory.Packages.props: the nearer one is the one that counts. */
export const NESTED = {
  'Directory.Packages.props': [
    '<Project>',
    '  <ItemGroup>',
    '    <PackageVersion Include="Serilog" Version="1.0.0" />',
    '  </ItemGroup>',
    '</Project>',
  ].join('\n'),
  'src/Directory.Packages.props': [
    '<Project>',
    '  <ItemGroup>',
    '    <PackageVersion Include="Serilog" Version="2.0.0" />',
    '  </ItemGroup>',
    '</Project>',
  ].join('\n'),
  'src/Near/Near.csproj': '<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><PackageReference Include="Serilog" /></ItemGroup></Project>',
  'far/Far.csproj': '<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><PackageReference Include="Serilog" /></ItemGroup></Project>',
};

/** The pre-CPM way of holding versions centrally: Update= in a shared file. */
export const UPDATED = {
  'Directory.Build.props': [
    '<Project>',
    '  <ItemGroup>',
    '    <PackageReference Update="Serilog" Version="3.0.0" />',
    '  </ItemGroup>',
    '</Project>',
  ].join('\n'),
  'src/App/App.csproj': '<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><PackageReference Include="Serilog" /></ItemGroup></Project>',
};
