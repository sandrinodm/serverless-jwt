import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Pnpm exits one when advisories exist; only a valid audit report can justify that exit code.
 */
let output;
/**
 * Retains the audit exit status while still allowing its structured advisory report to be
 * inspected.
 */
let auditStatus = 0;
try {
  output = execFileSync('pnpm', ['audit', '--json'], {
    cwd: resolve(import.meta.dirname, '..'),
    encoding: 'utf8',
    timeout: 30_000,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
} catch (error) {
  assert.equal(error.status, 1, 'Audit transport or execution failed');
  auditStatus = error.status;
  output = error.stdout;
}

/**
 * Any unknown finding or production dependency path fails; no severity threshold hides advisories.
 */
const report = JSON.parse(output);
assert.ok(
  report.advisories &&
    typeof report.advisories === 'object' &&
    !Array.isArray(report.advisories) &&
    !report.error,
  'Missing or failed audit report',
);
assert.equal(
  Object.keys(report.advisories).length,
  0,
  'Dependency advisories are forbidden; no development-only or legacy exceptions remain',
);
for (const severity of ['info', 'low', 'moderate', 'high', 'critical']) {
  assert.equal(
    report.metadata?.vulnerabilities?.[severity],
    0,
    'Missing or nonzero vulnerability count: ' + severity,
  );
}

assert.equal(auditStatus, 0, 'Audit returned an unsuccessful status despite an empty report');

console.log('Dependency audit passed: zero advisories, zero exceptions.');
