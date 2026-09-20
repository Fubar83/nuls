# nuls

List the NuGet packages a repository references, grouped by the project that references them.

```console
$ nuls
src/Api/Api.csproj
  Serilog                                  3.1.1
  Polly                                    7.2.4

src/Web/Web.csproj
  Serilog                                  4.2.0
  MyCompany.Core                           2.3.0
```

A version held in `Directory.Packages.props` is resolved onto the project that references it, so a line says what that project is actually on — not what one file happens to say.

Piped or redirected it prints one JSON object per line, each naming the repository and project it came from, so a sweep across many repositories needs no glue:

```console
$ repwrk foreach --parallel nuls > inventory.ndjson
$ head -2 inventory.ndjson
{"repo":"customer-api","project":"src/Api/Api.csproj","package":"Serilog","version":"3.1.1"}
{"repo":"customer-web","project":"src/Web/Web.csproj","package":"Serilog","version":"4.2.0"}
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

Each line carries the repository, the project, the package and the version — one line per reference, not one per project, because a line that stands on its own is what lets a sweep concatenate without any framing.

A repository with nothing to report still prints one line, with `package: null`, so that "nothing here" is data rather than silence.

## How a version is worked out

For each reference, in order:

1. `VersionOverride` on the reference
2. `Version` on the reference, as an attribute or a child element
3. the nearest `Directory.Packages.props` walking up from the project — the same one MSBuild would import
4. the nearest `Directory.Build.props` / `.targets`, for the pre-CPM `<PackageReference Update="X" Version="Y" />` spelling

Nothing found means the version is reported as missing rather than guessed at: `(no version found)` at a terminal, `null` in JSON. That is a real state — usually a reference to a package no central file declares.

`Directory.Packages.props` is never listed as referencing anything itself. It holds versions for projects; it does not use packages.

## What it reads

| Where | Spelling |
| --- | --- |
| `*.csproj`, `*.fsproj`, `*.vbproj` | `<PackageReference Include="X" Version="1.2.3" />` |
| any of the above | `<PackageReference Include="X"><Version>1.2.3</Version></PackageReference>` |
| any of the above | `<PackageReference Include="X" VersionOverride="1.2.3" />` |
| `Directory.Packages.props` | `<PackageVersion Include="X" Version="1.2.3" />` |
| `Directory.Build.props` / `.targets` | `<PackageReference Update="X" Version="1.2.3" />` |
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
