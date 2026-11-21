import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * Reserves the 200 executors plus sample keyrings awaiting kernel garbage collection.
 */
const REQUIRED_KEYS = 208;

/**
 * Checks observed quota exhaustion without performing any Docker or host mutation.
 */
export function assertKernelKeyQuota(
  quota: Readonly<Record<'maxKeys' | 'maxBytes' | 'usedKeys' | 'usedBytes', number>>,
): void {
  assert.ok(
    Object.values(quota).every((value) => Number.isSafeInteger(value) && value >= 0),
    'Cannot inspect local Docker keyring capacity',
  );
  assert.ok(
    quota.maxKeys - quota.usedKeys >= REQUIRED_KEYS &&
      quota.maxBytes - quota.usedBytes >= REQUIRED_KEYS,
    'Floci200 requires available Docker-user kernel key quota for 200 executors plus the eight-runtime capacity sample; provision kernel.keys.maxkeys/maxbytes (root_maxkeys/root_maxbytes for rootful Docker) before rerunning; this gate does not change host settings',
  );
}

/**
 * Rejects a known insufficient local Docker kernel key quota before expensive native provisioning.
 * This only reads host state; the full native proof must still establish actual capacity.
 */
export function assertFlociKeyringCapacity(): void {
  assert.equal(process.platform, 'linux', 'Floci200 requires a Linux Docker host');
  const security = JSON.parse(
    execFileSync('docker', ['info', '--format', '{{json .SecurityOptions}}'], {
      encoding: 'utf8',
      timeout: 10_000,
    }),
  ) as ReadonlyArray<string>;
  const rootless = security.some((value) => value === 'name=rootless');
  const uid = rootless ? process.getuid?.() : 0;
  assert.ok(uid !== undefined, 'Cannot inspect local Docker keyring capacity');
  const prefix = rootless ? '' : 'root_';
  const maxKeys = Number(readFileSync('/proc/sys/kernel/keys/' + prefix + 'maxkeys', 'utf8'));
  const maxBytes = Number(readFileSync('/proc/sys/kernel/keys/' + prefix + 'maxbytes', 'utf8'));
  const row = readFileSync('/proc/key-users', 'utf8')
    .split('\n')
    .find((line) => Number(/^\s*(\d+):/u.exec(line)?.[1]) === uid);
  const fields = row?.split(':')[1]?.trim().split(/\s+/u);
  const usedKeys = fields ? Number(fields[2]?.split('/')[0]) : undefined;
  const usedBytes = fields ? Number(fields[3]?.split('/')[0]) : undefined;

  const evidence = {
    rootless,
    uid,
    maxKeys,
    maxBytes,
    usedKeys: usedKeys ?? null,
    usedBytes: usedBytes ?? null,
    requiredKeys: REQUIRED_KEYS,
  };
  mkdirSync('reports/e2e', { recursive: true });
  writeFileSync(
    'reports/e2e/floci-keyring-capacity.json',
    JSON.stringify(evidence, null, 2) + '\n',
  );
  assertKernelKeyQuota({ maxKeys, maxBytes, usedKeys: usedKeys ?? 0, usedBytes: usedBytes ?? 0 });
}
