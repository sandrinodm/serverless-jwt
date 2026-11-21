import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { pathToFileURL } from 'node:url';

/**
 * Refuses undersized execution before installing tools; the case retains its fresh RSS preflight.
 */
export function assertNightlyCapacity({
  platform,
  arch,
  cpus,
  totalKiB,
  availableKiB,
  limitKiB = Infinity,
}) {
  assert.equal(platform, 'linux', 'Native nightly requires Linux');
  assert.equal(arch, 'x64', 'Native nightly requires x64 pinned runtime images');
  assert.ok(cpus >= 16, 'Native nightly requires the configured 16-core larger runner');
  assert.ok(
    Math.min(totalKiB, limitKiB) >= 60 * 1024 * 1024,
    'Native nightly requires the configured 64GB larger runner',
  );
  assert.ok(
    Math.min(availableKiB, limitKiB) > 30 * 1024 * 1024,
    'Native nightly requires more than30GiB available physical capacity',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const memory = readFileSync('/proc/meminfo', 'utf8');
  const cgroup = '/sys/fs/cgroup/memory.max';
  const limit = existsSync(cgroup) ? readFileSync(cgroup, 'utf8').trim() : 'max';
  assertNightlyCapacity({
    platform: process.platform,
    arch: process.arch,
    cpus: availableParallelism(),
    totalKiB: Number(/^MemTotal:\s+(\d+)/m.exec(memory)?.[1]),
    availableKiB: Number(/^MemAvailable:\s+(\d+)/m.exec(memory)?.[1]),
    limitKiB: limit === 'max' ? Infinity : Number(limit) / 1024,
  });
}
