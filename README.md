# nuls

List the NuGet packages a repository references, and merge those listings across many repositories into one report.

```console
$ repwrk foreach --parallel nuls 2>/dev/null | nuls --merge
MyCompany.Core  — 2 versions in use
    2.3.0            customer-web
    2.4.1            customer-api, customer-jobs
Serilog  — 2 versions in use
    3.1.1            customer-api
    4.2.0            customer-web, customer-jobs
Polly
    7.2.4            customer-api
```

The question it answers is not "what does this project use" — `dotnet list package` answers that, better — but **how many different answers does a set of repositories give**.

## Install

```bash
npm install -g @fub4r/nuls
```

## Requirements

- Node.js 22 or newer

No .NET SDK, no restore, no network.

## Use

```
nuls [--filter <glob>] [--json]           list this repository's packages
nuls --merge [--filter <glob>] [--json]   merge those listings into one report
```

`nuls` on its own reads the repository in the current directory. At a terminal it prints a version and a name per line; redirected or piped, it prints **one JSON object per line**, each naming the repository it came from — so a sweep needs no glue:

```bash
repwrk foreach --parallel nuls 2>/dev/null > inventory.ndjson
nuls --merge < inventory.ndjson
```

`repwrk` writes its `==>` headers to standard error and the command's own output to standard output, which is why the two halves pipe together cleanly. A line that is not JSON is skipped with a note, so a stray header does not spoil a report.

### `--filter <glob>`

`*` and `?`, anchored and case-insensitive — the same rules `repwrk --filter` uses for repository names.

```bash
repwrk foreach --parallel nuls --filter "MyCompany.*" 2>/dev/null | nuls --merge
```

Narrowing to your own packages turns the report into an adoption view: who is behind, and on what.

### `--json`

The scan is always JSON when piped. `--merge --json` gives the report as structured data: one entry per package, with `spread` (how many distinct versions are in use), `repos`, and the versions each repository is on.

## What it reads

Project files, directly:

| Where | Spelling |
| --- | --- |
| `*.csproj`, `*.fsproj`, `*.vbproj` | `<PackageReference Include="X" Version="1.2.3" />` |
| any of the above | `<PackageReference Include="X"><Version>1.2.3</Version></PackageReference>` |
| `Directory.Packages.props` | `<PackageVersion Include="X" Version="1.2.3" />` |
| a project under central package management | `VersionOverride="1.2.3"` |
| `.props` / `.targets` | `<PackageReference Update="X" Version="1.2.3" />` |
| `packages.config` | `<package id="X" version="1.2.3" />` |

`bin`, `obj`, `node_modules` and `.vs` are never walked into, and a commented-out reference is not a reference.

Each row carries `kind` — `reference`, `central` or `packages.config` — because that is what says where a version can be changed.

## What it does not read

**This is what the repository declares, not what NuGet resolves.**

- **A version written as an MSBuild property** is reported as `$(CoreVersion)`, not as its value. Evaluating it would mean being MSBuild.
- **Transitive dependencies** are not here at all. Only direct references are.
- **Conditional `ItemGroup`s** are read as written, whatever their condition.

Neither an inherited version nor an unevaluated property counts towards `spread`, since neither is an answer to "which version is this repository on".

When you need resolved truth and the repository restores, ask the SDK:

```bash
dotnet list package --include-transitive --format json
```

That evaluates MSBuild properly — and needs a successful `dotnet restore` first, for every repository. Reading the files needs nothing, which is the trade: `nuls` still answers in a repository that will not restore, and across forty clones that is usually several of them.

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

Scanning is tested against real fixture trees covering each layout, and the CLI is tested by running it.

## Licence

MIT
