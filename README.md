# nuls

List the NuGet packages a repository references — one line of JSON per reference, each naming the repository it came from.

```console
$ nuls
3.1.1            Serilog
7.2.4            Polly
$(CoreVersion)   MyCompany.Core
```

Piped or redirected it prints JSON instead, so a sweep across many repositories is one command and needs no glue:

```console
$ repwrk foreach --parallel nuls > inventory.ndjson
$ head -2 inventory.ndjson
{"repo":"customer-api","file":"src/Api/Api.csproj","package":"Serilog","version":"3.1.1","kind":"reference"}
{"repo":"customer-web","file":"Directory.Packages.props","package":"Serilog","version":"4.2.0","kind":"central"}
```

`repwrk` writes its `==>` headers to standard error and the command's own output to standard output, which is why only the packages reach the file.

## Install

```bash
npm install -g @fub4r/nuls
```

## Requirements

- Node.js 22 or newer

No .NET SDK, no restore, no network.

## Use

```
nuls [--filter <glob>] [--json]
```

That is the whole surface. It reads the repository in the current directory and prints what it finds; combining, filtering further or counting is whatever reads the lines.

### `--filter <glob>`

`*` and `?`, anchored and case-insensitive — the same rules `repwrk --filter` uses for repository names.

```bash
repwrk foreach --parallel nuls --filter "MyCompany.*"
```

### `--json`

Output is already JSON whenever it is piped or redirected. `--json` asks for it at a terminal too.

Each line carries the repository, the file, the package, the version as written, and `kind`:

| `kind` | Means |
| --- | --- |
| `reference` | a project's own `PackageReference` |
| `central` | `PackageVersion` in `Directory.Packages.props` |
| `packages.config` | the pre-SDK format |

`kind` is what says where a version can be changed. A repository with nothing to report still prints one line, with `package: null`, so that "nothing here" is data rather than silence.

## What it reads

| Where | Spelling |
| --- | --- |
| `*.csproj`, `*.fsproj`, `*.vbproj` | `<PackageReference Include="X" Version="1.2.3" />` |
| any of the above | `<PackageReference Include="X"><Version>1.2.3</Version></PackageReference>` |
| `Directory.Packages.props` | `<PackageVersion Include="X" Version="1.2.3" />` |
| a project under central package management | `VersionOverride="1.2.3"` |
| `.props` / `.targets` | `<PackageReference Update="X" Version="1.2.3" />` |
| `packages.config` | `<package id="X" version="1.2.3" />` |

`bin`, `obj`, `node_modules` and `.vs` are never walked into, and a commented-out reference is not a reference.

## What it does not read

**This is what a repository declares, not what NuGet resolves.**

- **A version written as an MSBuild property** is reported as `$(CoreVersion)`, not as its value. Evaluating it would mean being MSBuild.
- **Transitive dependencies** are not here at all. Only direct references are.
- **Conditional `ItemGroup`s** are read as written, whatever their condition.

When you need resolved truth and the repository restores, ask the SDK instead:

```bash
dotnet list package --include-transitive --format json
```

That evaluates MSBuild properly — and needs a successful `dotnet restore` first, in every repository. Reading the files needs nothing, which is the trade: `nuls` still answers in a repository that will not restore, and across forty clones there are usually a few.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success — including finding nothing |
| `1` | Runtime failure |
| `2` | Usage error: unknown option, or a missing option value |

## Development

```bash
npm test
```

Scanning is tested against fixture trees covering each layout, and the CLI is tested by running it.

## Licence

MIT
