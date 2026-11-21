import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'vite-plus/test';

/**
 * Exercises the actual audit command with recorded reports and transport outcomes.
 */
function audit(report, status = 0) {
  const directory = mkdtempSync(join(tmpdir(), 'jwt-audit-negative-'));
  try {
    const command = join(directory, 'pnpm');
    writeFileSync(
      command,
      `#!${process.execPath}\nprocess.stdout.write(process.env.AUDIT_REPORT); process.exit(Number(process.env.AUDIT_STATUS));\n`,
    );
    chmodSync(command, 0o755);
    const result = spawnSync(process.execPath, [resolve('scripts/audit-dependencies.mjs')], {
      env: {
        ...process.env,
        PATH: directory + ':' + process.env.PATH,
        AUDIT_REPORT: typeof report === 'string' ? report : JSON.stringify(report),
        AUDIT_STATUS: String(status),
      },
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(result.error, undefined);
    return result;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const clean = {
  advisories: {},
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 } },
};
test('actual audit gate accepts only a complete zero-advisory report', () => {
  const result = audit(clean);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /zero advisories, zero exceptions/);
  assert.notEqual(audit(clean, 1).status, 0);
});

for (const [name, report, status] of [
  [
    'former legacy development exception',
    {
      ...clean,
      advisories: {
        old: {
          github_advisory_id: 'GHSA-8cf7-32gw-wr33',
          module_name: 'jsonwebtoken',
          findings: [{ version: '8.5.1', dev: true }],
        },
      },
    },
    1,
  ],
  ['unknown advisory', { ...clean, advisories: { unknown: { module_name: 'unknown' } } }, 1],
  [
    'hidden nonzero severity',
    { ...clean, metadata: { vulnerabilities: { ...clean.metadata.vulnerabilities, low: 1 } } },
    0,
  ],
  ['transport error', clean, 2],
  ['API error', { ...clean, error: { code: 'EHTTP' } }, 1],
  ['missing shape', {}, 0],
  ['invalid JSON', '{', 0],
]) {
  assert.ok(typeof name === 'string');
  test(`actual audit gate rejects ${name}`, () => {
    assert.notEqual(audit(report, status).status, 0);
  });
}
