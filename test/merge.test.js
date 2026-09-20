import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatReport, mergeRows } from '../src/merge.js';

const row = (repo, name, version, kind = 'reference') => ({ repo, package: name, version, kind });

test('the same package at different versions is one entry', () => {
  const report = mergeRows([
    row('api', 'Serilog', '3.1.1'),
    row('web', 'Serilog', '4.2.0'),
    row('jobs', 'Serilog', '3.1.1'),
  ]);

  assert.equal(report.length, 1);
  assert.equal(report[0].spread, 2);
  assert.deepEqual(report[0].versions, [
    { version: '3.1.1', repos: ['api', 'jobs'] },
    { version: '4.2.0', repos: ['web'] },
  ]);
});

test('the most split package is reported first', () => {
  const report = mergeRows([
    row('api', 'Agreed', '1.0.0'),
    row('web', 'Agreed', '1.0.0'),
    row('api', 'Split', '1.0.0'),
    row('web', 'Split', '2.0.0'),
  ]);

  assert.deepEqual(
    report.map((entry) => entry.package),
    ['Split', 'Agreed'],
  );
});

test('an inherited version is not an answer to which version', () => {
  const report = mergeRows([
    row('web', 'Serilog', '4.2.0', 'central'),
    row('web', 'Serilog', null),
  ]);

  // One real version and one "declared elsewhere" is not two versions in use.
  assert.equal(report[0].spread, 1);
});

test('an unevaluated property does not count as a version either', () => {
  const report = mergeRows([row('api', 'Core', '$(CoreVersion)'), row('web', 'Core', '2.4.1')]);

  assert.equal(report[0].spread, 1);
});

test('a repository that references nothing contributes nothing', () => {
  const report = mergeRows([{ repo: 'empty', package: null }, row('api', 'Serilog', '3.1.1')]);

  assert.deepEqual(
    report.map((entry) => entry.package),
    ['Serilog'],
  );
});

test('a filter applies to the merged report too', () => {
  const report = mergeRows([row('api', 'MyCompany.Core', '2.4.1'), row('api', 'Serilog', '3.1.1')], {
    filter: 'MyCompany.*',
  });

  assert.deepEqual(
    report.map((entry) => entry.package),
    ['MyCompany.Core'],
  );
});

test('the report says which repositories are on which version', () => {
  const text = formatReport(mergeRows([row('api', 'Serilog', '3.1.1'), row('web', 'Serilog', '4.2.0')]));

  assert.match(text, /Serilog.*2 versions in use/);
  assert.match(text, /3\.1\.1\s+api/);
  assert.match(text, /4\.2\.0\s+web/);
});
