import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

import { capabilityMatrix, flociIsolationFile } from '../e2e/matrix.ts';

/**
 * Rejects omitted, skipped or filtered capability rows, using actual Vitest test results.
 */
export default class E2eReporter {
  /**
   * Records only passed test cases from the current run, never prior artifact files.
   */
  onTestRunStart(specifications) {
    this.nightly = specifications.some((specification) => specification.project.name === 'nightly');
    this.passed = new Set();
    this.started = Date.now();
  }

  /**
   * Matches independently named matrix cases to real completed tests and source modules.
   */
  onTestCaseResult(test) {
    if (test.result().state === 'passed') {
      this.passed.add(test.module.moduleId.replaceAll('\\', '/') + '#' + test.name);
    }
  }

  /**
   * Fails closed if filtering or configuration prevents even one assigned row from running.
   */
  onTestRunEnd() {
    const candidates = capabilityMatrix.filter(
      (row) =>
        (this.nightly || row.project === 'pr') &&
        (!process.env.E2E_INTEGRATION || row.integration === process.env.E2E_INTEGRATION) &&
        (!process.env.E2E_APPLICATION ||
          (row.application ?? row.integration) === process.env.E2E_APPLICATION) &&
        (!process.env.E2E_RUNTIME || row.host === process.env.E2E_RUNTIME),
    );
    const scope = this.nightly ? (process.env.E2E_NIGHTLY_SCOPE ?? 'full') : 'pr';
    const rows = candidates.filter((row) => {
      if (scope === 'floci200') {
        return row.file === flociIsolationFile;
      }

      return scope !== 'standard' || row.file !== flociIsolationFile;
    });
    const excludedRows = candidates.filter((row) => !rows.includes(row)).map((row) => row.id);
    const results = rows.map((row) => ({
      ...row,
      passed: [...this.passed].some(
        (entry) => entry.includes('/' + row.file + '#') && entry.endsWith('#capability: ' + row.id),
      ),
    }));
    mkdirSync('reports/e2e-matrix', { recursive: true });
    writeFileSync(
      'reports/e2e-matrix/current.json',
      JSON.stringify(
        { started: this.started, completed: Date.now(), scope, excludedRows, rows: results },
        null,
        2,
      ) + '\n',
    );
    assert.ok(results.length, 'No capability rows were assigned');
    assert.deepEqual(
      results.filter((row) => !row.passed).map((row) => row.id),
      [],
      'Every assigned e2e capability row must pass in this run',
    );
  }
}
