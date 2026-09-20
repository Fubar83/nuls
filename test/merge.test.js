import assert from 'node:assert/strict';
import { test } from 'node:test';
import { byPackage, byProject, formatByPackage, formatByProject } from '../src/merge.js';

const row = (repo, project, name, version) => ({ repo, project, package: name, version });

test('the same package at different versions is one entry', () => {
  const report = byPackage([
    row('api', 'src/Api.csproj', 'Serilog', '3.1.1'),
    row('web', 'src/Web.csproj', 'Serilog', '4.2.0'),
    row('jobs', 'src/Jobs.csproj', 'Serilog', '3.1.1'),
  ]);

  assert.equal(report.length, 1);
  assert.equal(report[0].versionsInUse, 2);
  assert.equal(report[0].repos, 3);
  assert.deepEqual(
    report[0].versions.map((one) => [one.version, one.repos]),
    [
      ['3.1.1', ['api', 'jobs']],
      ['4.2.0', ['web']],
    ],
  );
});

test('the most split package is reported first', () => {
  const report = byPackage([
    row('api', 'a.csproj', 'Agreed', '1.0.0'),
    row('web', 'b.csproj', 'Agreed', '1.0.0'),
    row('api', 'a.csproj', 'Split', '1.0.0'),
    row('web', 'b.csproj', 'Split', '2.0.0'),
  ]);

  assert.deepEqual(
    report.map((entry) => entry.package),
    ['Split', 'Agreed'],
  );
});

test('two projects in one repository on different versions still disagree', () => {
  const report = byPackage([
    row('api', 'src/One.csproj', 'Serilog', '3.1.1'),
    row('api', 'src/Two.csproj', 'Serilog', '4.2.0'),
  ]);

  // A repository at odds with itself is worth seeing, not flattening away.
  assert.equal(report[0].versionsInUse, 2);
  assert.equal(report[0].repos, 1);
});

test('an unevaluated property is not a version anyone chose', () => {
  const report = byPackage([
    row('api', 'a.csproj', 'Core', '$(CoreVersion)'),
    row('web', 'b.csproj', 'Core', '2.4.1'),
  ]);

  // --files leaves properties as written; counting one as a version would say
  // two repositories disagree when nothing of the sort has been shown.
  assert.equal(report[0].versionsInUse, 1);
});

test('a reference with no version found is not a version either', () => {
  const report = byPackage([
    row('api', 'a.csproj', 'Orphan', null),
    row('web', 'b.csproj', 'Orphan', '1.0.0'),
  ]);

  assert.equal(report[0].versionsInUse, 1);
  assert.ok(report[0].versions.some((one) => one.version === '(no version found)'));
});

test('a repository that referenced nothing contributes nothing', () => {
  const report = byPackage([
    { repo: 'empty', package: null },
    row('api', 'a.csproj', 'Serilog', '3.1.1'),
  ]);

  assert.deepEqual(
    report.map((entry) => entry.package),
    ['Serilog'],
  );
});

test('by package, the projects are kept as well as the repositories', () => {
  const report = byPackage([row('api', 'src/Api.csproj', 'Serilog', '3.1.1')]);

  assert.deepEqual(report[0].versions[0].projects, ['api/src/Api.csproj']);
});

test('by project, rows become repository then project then packages', () => {
  const report = byProject([
    row('web', 'src/Web.csproj', 'Serilog', '4.2.0'),
    row('api', 'src/Api.csproj', 'Polly', '7.2.4'),
    row('api', 'src/Api.csproj', 'Serilog', '3.1.1'),
    row('api', 'tests/Api.Tests.csproj', 'xunit.v3', '4.0.1'),
  ]);

  assert.deepEqual(
    report.map((entry) => entry.repo),
    ['api', 'web'],
  );
  assert.deepEqual(
    report[0].projects.map((one) => one.project),
    ['src/Api.csproj', 'tests/Api.Tests.csproj'],
  );
  assert.deepEqual(
    report[0].projects[0].packages.map((one) => one.package),
    ['Polly', 'Serilog'],
  );
});

test('a filter applies to both views', () => {
  const rows = [
    row('api', 'a.csproj', 'MyCompany.Core', '2.4.1'),
    row('api', 'a.csproj', 'Serilog', '3.1.1'),
  ];

  assert.deepEqual(
    byPackage(rows, { filter: 'MyCompany.*' }).map((entry) => entry.package),
    ['MyCompany.Core'],
  );
  assert.deepEqual(
    byProject(rows, { filter: 'MyCompany.*' })[0].projects[0].packages.map((one) => one.package),
    ['MyCompany.Core'],
  );
});

test('the printed report says which repositories are on which version', () => {
  const text = formatByPackage(
    byPackage([
      row('api', 'a.csproj', 'Serilog', '3.1.1'),
      row('web', 'b.csproj', 'Serilog', '4.2.0'),
    ]),
  );

  assert.match(text, /Serilog.*2 versions in use/);
  assert.match(text, /3\.1\.1\s+api/);
  assert.match(text, /4\.2\.0\s+web/);
});

test('the printed tree indents a project under its repository', () => {
  const text = formatByProject(byProject([row('api', 'src/Api.csproj', 'Serilog', '3.1.1')]));

  assert.match(text, /^api$/m);
  assert.match(text, /^ {2}src\/Api\.csproj$/m);
  assert.match(text, /^ {4}Serilog\s+3\.1\.1$/m);
});
