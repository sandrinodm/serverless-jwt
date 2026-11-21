import { createHash } from 'node:crypto';
import { mkdtempDisposableSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vite-plus/test';

import { privateLogs } from './logs.ts';

it('processes a megabyte of clean logs with a complete digest and bounded fingerprint-only artifact', () => {
  using directory = mkdtempDisposableSync(join(tmpdir(), 'jwt-stream-clean-'));
  const logs = privateLogs([], 'fingerprints');
  const chunk = Buffer.from('normal invocation metadata\n'.repeat(1000));
  const digest = createHash('sha256');
  let bytes = 0;
  for (let index = 0; index < 50; index++) {
    logs.capture(chunk);
    digest.update(chunk);
    bytes += chunk.length;
  }

  const file = join(directory.path, 'server.log');
  expect(() => logs.finish(file)).not.toThrow();
  expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({
    mode: 'fingerprints',
    bytes,
    sha256: digest.digest('hex'),
    tokenEvents: 0,
    registryChanged: false,
    candidateOverflow: false,
  });
  expect(statSync(file).size).toBeLessThan(65_536);
  expect(statSync(file).mode & 0o777).toBe(0o600);
});

it.each(['early', 'split', 'late', 'opaque-utf8', 'unknown-jwt'] as const)(
  'permanently detects real-volume %s credentials without exposing plaintext',
  (position) => {
    using directory = mkdtempDisposableSync(join(tmpdir(), 'jwt-stream-secret-'));
    const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJwcml2YXRlIn0.signature';
    const opaque = 'opaque-🔑\n-private-control';
    const token = position === 'opaque-utf8' ? opaque : jwt;
    const logs = privateLogs(position === 'unknown-jwt' ? [] : [token], 'fingerprints');
    const volume = Buffer.from('normal metadata\n'.repeat(10_000));
    const digest = createHash('sha256');
    let bytes = 0;
    const capture = (chunk: Buffer): void => {
      logs.capture(chunk);
      digest.update(chunk);
      bytes += chunk.length;
    };
    if (position === 'late') {
      capture(volume);
    }

    const credential = Buffer.from(token + '\n');
    for (let index = 0; index < credential.length; index++) {
      capture(credential.subarray(index, index + 1));
    }

    capture(volume);
    const file = join(directory.path, 'server.log');
    expect(() => logs.finish(file)).toThrow('Server log contains a credential');
    const output = readFileSync(file, 'utf8');
    expect(output.includes(token)).toBe(false);
    expect(JSON.parse(output)).toMatchObject({
      bytes,
      sha256: digest.digest('hex'),
      candidateOverflow: false,
    });
    expect(JSON.parse(output).tokenEvents).toBeGreaterThan(0);
    expect(output).toMatch(/\[token:[a-f0-9]{12}\]/);
  },
);

it('fails closed on late opaque registry changes and oversized unknown candidate boundaries', () => {
  using directory = mkdtempDisposableSync(join(tmpdir(), 'jwt-stream-boundary-'));
  const tokens: string[] = [];
  const logs = privateLogs(tokens, 'fingerprints');
  logs.capture('early-opaque-secret\n' + 'safe line\n'.repeat(10_000));
  tokens.push('early-opaque-secret');
  const file = join(directory.path, 'registry.log');
  expect(() => logs.finish(file)).toThrow('changes its token registry');
  expect(readFileSync(file, 'utf8')).not.toContain('early-opaque-secret');
  expect(JSON.parse(readFileSync(file, 'utf8')).registryChanged).toBe(true);
  const overflow = privateLogs([], 'fingerprints');
  overflow.capture('x'.repeat(65_537));
  const overflowFile = join(directory.path, 'overflow.log');
  expect(() => overflow.finish(overflowFile)).toThrow('exceeds the candidate bound');
  expect(JSON.parse(readFileSync(overflowFile, 'utf8')).candidateOverflow).toBe(true);
});

it('handles compact candidates at EOF, after dot-delimited log prefixes, and at the exact bound', () => {
  using directory = mkdtempDisposableSync(join(tmpdir(), 'jwt-stream-eof-'));
  const jwt = 'e30.e30.' + 'x'.repeat(65_528);
  expect(jwt.length).toBe(65_536);
  const logs = privateLogs([], 'fingerprints');
  logs.capture(Buffer.from(jwt));
  const file = join(directory.path, 'eof.log');
  expect(() => logs.finish(file)).toThrow('contains a credential');
  expect(JSON.parse(readFileSync(file, 'utf8')).candidateOverflow).toBe(false);
  const prefixed = privateLogs([], 'fingerprints');
  prefixed.capture('org.example.e30.e30.x');
  const prefixFile = join(directory.path, 'prefix.log');
  expect(() => prefixed.finish(prefixFile)).toThrow('contains a credential');
  expect(JSON.parse(readFileSync(prefixFile, 'utf8')).tokenEvents).toBeGreaterThan(0);
});
