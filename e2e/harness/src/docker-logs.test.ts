import { existsSync, mkdtempDisposableSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import { captureDockerLogs, dockerLogs, privateCommand } from './docker-logs.ts';

/**
 * A synthetic credential exercises both known-token and unknown compact-token detection.
 */
const TOKEN = 'e30.eyJzdWIiOiJwcml2YXRlIn0.signature';

afterEach(() => {
  vi.unstubAllEnvs();
});

it('joins delayed EOF before redacting a final credential split across transport chunks', async () => {
  using directory = mkdtempDisposableSync(join(tmpdir(), 'jwt-docker-eof-'));
  const logs = dockerLogs([]);
  const stream = new PassThrough();
  logs.attach(stream);
  stream.write(TOKEN.slice(0, 8));
  const file = join(directory.path, 'server.log');
  const finish = logs.finish(file);
  expect(existsSync(file)).toBe(false);
  stream.end(TOKEN.slice(8));
  await expect(finish).rejects.toThrow('credential');
  expect(readFileSync(file, 'utf8')).toMatch(/\[token:[a-f0-9]{12}\]/);
  expect(readFileSync(file, 'utf8')).not.toContain(TOKEN);
});

it.each(['error', 'premature-close', 'missing-eof', 'unattached'] as const)(
  'fails closed with token-free output after %s',
  async (mode) => {
    using directory = mkdtempDisposableSync(join(tmpdir(), 'jwt-docker-loss-'));
    const logs = dockerLogs([], 'buffer', undefined, 10);
    const stream = new PassThrough();
    if (mode !== 'unattached') {
      logs.attach(stream);
      stream.write('ordinary metadata\n');
    }

    if (mode === 'error') {
      stream.destroy(new Error(TOKEN));
    } else if (mode === 'premature-close') {
      stream.destroy();
    }

    const file = join(directory.path, 'server.log');
    await expect(logs.finish(file)).rejects.toThrow('did not capture complete output');
    expect(readFileSync(file, 'utf8')).not.toContain(TOKEN);
    expect(mode === 'unattached' || stream.destroyed).toBe(true);
  },
);

it('retains fingerprint-only capture after a checkpoint and joins both stdout and stderr', async () => {
  using directory = mkdtempDisposableSync(join(tmpdir(), 'jwt-docker-checkpoint-'));
  const logs = dockerLogs([TOKEN]);
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  logs.attach(stdout);
  logs.attach(stderr);
  stdout.write('startup complete\n');
  logs.seal(join(directory.path, 'startup.log'));
  stdout.end('ordinary invocation\n'.repeat(50_000));
  const file = join(directory.path, 'runtime.log');
  const finish = logs.finish(file);
  stderr.end(TOKEN);
  await expect(finish).rejects.toThrow('credential');
  const output = readFileSync(file, 'utf8');
  expect(JSON.parse(output)).toMatchObject({ mode: 'fingerprints', candidateOverflow: false });
  expect(output.length).toBeLessThan(1000);
  expect(output).not.toContain(TOKEN);
});

it.each(['opaque', 'unknown-jwt'] as const)(
  'detects a credential split across the startup checkpoint: %s',
  async (kind) => {
    const token = kind === 'opaque' ? 'opaque-credential' : TOKEN;
    using directory = mkdtempDisposableSync(join(tmpdir(), 'jwt-docker-seal-split-'));
    const logs = dockerLogs(token === TOKEN ? [] : [token]);
    const stream = new PassThrough();
    logs.attach(stream);
    stream.write(token.slice(0, 7));
    logs.seal(join(directory.path, 'startup.log'));
    stream.end(token.slice(7));
    const file = join(directory.path, 'runtime.log');
    await expect(logs.finish(file)).rejects.toThrow('credential');
    expect(readFileSync(file, 'utf8')).not.toContain(token);
  },
);

it('fails on ordinary buffer truncation even with successful EOF', async () => {
  using directory = mkdtempDisposableSync(join(tmpdir(), 'jwt-docker-overflow-'));
  const logs = dockerLogs([]);
  const stream = new PassThrough();
  logs.attach(stream);
  stream.end('metadata\n'.repeat(10_000));
  const file = join(directory.path, 'server.log');
  await expect(logs.finish(file)).rejects.toThrow('exceeds the private buffer');
  expect(readFileSync(file, 'utf8')).toContain('output discarded');
});

it('bounds a real stalled Docker command and kills its owned descendant group', async () => {
  using directory = mkdtempDisposableSync(join(tmpdir(), 'jwt-docker-child-'));
  const fixture = join(directory.path, 'fixture.cjs');
  const pidFile = join(directory.path, 'descendant.pid');
  writeFileSync(
    fixture,
    `
    const {spawn} = require('node:child_process');
    const {writeFileSync} = require('node:fs');
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{}, 1000)'], {stdio:'inherit'});
    writeFileSync(process.env.DOCKER_LOG_PID, String(child.pid));
    process.stdout.write('ordinary metadata\\n');
    setInterval(()=>{},1000);
  `,
  );
  writeFileSync(
    join(directory.path, 'docker'),
    '#!/bin/sh\nexec "' + process.execPath + '" "' + fixture + '"\n',
    { mode: 0o700 },
  );
  vi.stubEnv('PATH', directory.path + ':' + process.env.PATH);
  vi.stubEnv('DOCKER_LOG_PID', pidFile);
  const logs = dockerLogs([], 'buffer', undefined, 20);
  const started = performance.now();
  await expect(captureDockerLogs('owned-fixture', logs.attach, 500)).rejects.toThrow('deadline');
  expect(performance.now() - started).toBeLessThan(2_000);
  expect(existsSync(pidFile)).toBe(true);
  const pid = readFileSync(pidFile, 'utf8');
  await expect
    .poll(() => {
      try {
        return /\) [ZX] /.test(readFileSync('/proc/' + pid + '/stat', 'utf8'));
      } catch {
        return true;
      }
    })
    .toBe(true);
  const file = join(directory.path, 'server.log');
  await expect(logs.finish(file)).rejects.toThrow('did not capture complete output');
  expect(readFileSync(file, 'utf8')).toContain('ordinary metadata');
});

it('bounds real cleanup output and hides command failures without exposing diagnostics', async () => {
  const output = await privateCommand(process.execPath, [
    '-e',
    "process.stdout.write('owned-container\\n');process.stderr.write('private diagnostic')",
  ]);
  expect(output).toBe('owned-container\n');
  await expect(
    privateCommand(process.execPath, [
      '-e',
      'process.stderr.write(' + JSON.stringify(TOKEN) + ');process.exit(1)',
    ]),
  ).rejects.toThrow('Owned subprocess failed');
  await expect(
    privateCommand(process.execPath, [
      '-e',
      "process.stdout.write('x'.repeat(65_537));setInterval(()=>{},1000)",
    ]),
  ).rejects.toThrow('private output bound');
  await expect(privateCommand('/missing-private-command', [])).rejects.toThrow(
    'Owned subprocess failed',
  );
});
