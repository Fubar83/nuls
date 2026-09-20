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

`repwrk` writes its `==>` headers to standard error and the command's own output to standard output, which is why only the packages reach the file — or the next command:

```console
$ repwrk foreach --parallel nuls | nuls --merge
Serilog  — 2 versions in use
  3.1.1              customer-api
  4.2.0              customer-jobs, customer-web
```

## Install

```bash
npm install -g @fub4r/nuls
```

## Requirements

- Node.js 22 or newer
- The .NET SDK, for the default engine — `--files` needs only Node

No restore and no network either way: MSBuild is asked to *evaluate* a project, not to build or restore it.

## Use

```
nuls [--filter <glob>] [--json] [--files]
nuls --merge [--by package|project] [--filter <glob>] [--json]
```

`nuls` on its own reads the repository in the current directory. `nuls --merge` reads those listings back on standard input and reports across all of them.

### `--merge`

**By package** — the default, and the reason to merge at all: which versions of something are in play, and who is on each.

```console
$ repwrk foreach --parallel nuls | nuls --merge
Serilog  — 2 versions in use
  3.1.1              customer-api
  4.2.0              customer-jobs, customer-web

Polly
  7.2.4              customer-api
```

Packages are ordered by how split they are, so whatever is most inconsistent is the first thing you read. Two projects *within one repository* on different versions count as split too — a repository at odds with itself is worth seeing.

Neither `(no version found)` nor an unevaluated `$(Property)` counts towards that number. Neither is a version anyone chose, so neither can show that two repositories disagree.

**By project** — the same rows as a tree, for reading an estate rather than interrogating it.

```console
$ repwrk foreach --parallel nuls | nuls --merge --by project
customer-api
  src/Api/Api.csproj
    Polly                                        7.2.4
    Serilog                                      3.1.1
  tests/Api.Tests/Api.Tests.csproj
    xunit.v3                                     4.0.1

customer-web
  src/Web/Web.csproj
    Serilog                                      4.2.0
```

A line that is not JSON is skipped with a note, so a stray header cannot spoil a report.

### `--filter <glob>`

`*` and `?`, anchored and case-insensitive — the same rules `repwrk --filter` uses for repository names.

```bash
repwrk foreach --parallel nuls --filter "MyCompany.*"
```

### `--json`

Output is already JSON whenever it is piped or redirected. `--json` asks for it at a terminal too.

Each line carries the repository, the project, the package and the version — one line per reference, not one per project, because a line that stands on its own is what lets a sweep concatenate without any framing.

With `--merge` it gives the report as structured data instead: one entry per package with `versionsInUse`, `repos` and the versions each repository and project is on, or the repository/project tree under `--by project`.

A repository with nothing to report still prints one line, with `package: null`, so that "nothing here" is data rather than silence.

## How a version is worked out

MSBuild is asked first — `dotnet msbuild -getItem` evaluates a project without restoring it, so properties are expanded and the import chain is followed by the SDK rather than approximated here.

Two things it leaves to nuls:

- **Central package management is applied during restore, not evaluation.** A `PackageReference` under CPM comes back with no version and the `PackageVersion` items come back separately; putting them together is nuls's job.
- **A multi-targeted project hides its conditional references** from the outer build, where `$(TargetFramework)` is empty. Each framework the project names is asked for in turn, and the answers are combined.

So, for each reference: `VersionOverride`, then the reference's own `Version`, then the matching `PackageVersion`. A version nothing declares is reported as missing rather than guessed at — `(no version found)` at a terminal, `null` in JSON.

`packages.config` is read directly. It is a list of versions, not a build, and MSBuild has nothing to say about it.

### When a project will not load

A malformed project makes MSBuild report an error instead of an answer. nuls says so on standard error and reads the file instead, so one broken file does not leave a hole in a sweep.

### `--files`

Skips MSBuild entirely and reads the project files. Faster, and works without a .NET SDK, at the cost of the two things only MSBuild can do: a version written as a property stays `$(CoreVersion)`, and a condition is ignored rather than evaluated.

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

## What it does not tell you

**This is what a repository declares, not what NuGet resolves.**

- **Transitive dependencies are not here.** Only what a project references directly. Working out the rest means resolving the graph, which means restoring.
- **A version is a version as declared**, so a range (`[4.0,5.0)`) or a floating version (`4.*`) is reported as written rather than as whatever it would resolve to today.
- **Nothing is checked against a feed**, so "outdated" and "vulnerable" are questions for another tool.

With `--files`, two more: a version written as a property stays `$(CoreVersion)`, and a reference conditioned on a target framework is listed whatever its condition says.

When you want resolved truth, including transitives, ask the SDK:

```bash
dotnet list package --include-transitive --format json
```

That reports what NuGet actually resolved — and needs a successful `dotnet restore` first, in every repository, which across forty clones is the slow and fragile part. nuls asks MSBuild to *evaluate* rather than restore, which is why it answers in seconds and still answers in a repository that will not restore.

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
