import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Prevents empty reports or changed globs from silently dropping any core production module.
 */
const source = resolve('packages/jwt-verifier/src');
/**
 * Inventories every production module so an incomplete coverage report cannot satisfy the gate.
 */
const expected = readdirSync(source, { recursive: true })
  .filter((file) => file.endsWith('.ts') && !/\.(test|spec)\.ts$/.test(file) && file !== 'index.ts')
  .map((file) => resolve(source, file))
  .sort();
/**
 * Loads per-file execution coverage for comparison with the complete production inventory.
 */
const coverage = JSON.parse(readFileSync(resolve('coverage/coverage-final.json'), 'utf8'));
assert.deepEqual(
  Object.keys(coverage).sort(),
  expected,
  'Coverage must include every core production module, excluding only index re-exports',
);
/**
 * Loads aggregate coverage totals for the unchanged line and branch thresholds.
 */
const total = JSON.parse(readFileSync(resolve('coverage/coverage-summary.json'), 'utf8')).total;
assert.ok(total.lines.total > 0 && total.branches.total > 0, 'Empty coverage report');
assert.equal(total.lines.pct, 100);
assert.equal(total.branches.pct, 100);
console.log(`100% lines and branches across all ${expected.length} core modules.`);
