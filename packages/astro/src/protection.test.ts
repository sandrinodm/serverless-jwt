import { ConfigurationError } from '@serverless-jwt/jwt-verifier';
import { expect, it } from 'vite-plus/test';

import { assertRegistration, matchesPath, routingPath, validatePatterns } from './protection.ts';

it('validates and snapshots the small exact-path/terminal-subtree grammar', () => {
  const configured = ['/api/**', '/café'];
  const copied = validatePatterns(configured);
  configured[0] = '/public/**';
  expect(copied).toEqual(['/api/**', '/café']);
  expect(Object.isFrozen(copied)).toBe(true);
  for (const invalid of [
    undefined,
    null,
    {},
    [],
    [12],
    ['api'],
    ['/api/*'],
    ['/api/**/nested'],
    ['/api?x'],
    ['/api#x'],
    ['/api%20'],
    ['/api//nested'],
    ['//**'],
    ['/api/../private'],
    ['/api/./private'],
    ['/api/'],
  ]) {
    expect(() => validatePatterns(invalid)).toThrow(ConfigurationError);
  }

  expect(validatePatterns(['/', '/**'])).toEqual(['/', '/**']);
});

it('matches segment boundaries, subtree roots and trailing slashes', () => {
  for (const path of ['/api', '/api/', '/api/me', '/api/me/']) {
    expect(matchesPath(path, ['/api/**'])).toBe(true);
  }

  for (const path of ['/apix', '/public', '/']) {
    expect(matchesPath(path, ['/api/**'])).toBe(false);
  }

  expect(matchesPath('/api/', ['/api'])).toBe(true);
  expect(matchesPath('/', ['/'])).toBe(true);
  expect(matchesPath('/anything', ['/**'])).toBe(true);
});

it('matches bounded framework decoding, preserves reserved separators and rejects malformed encoding', () => {
  expect(routingPath('/%61pi/me')).toBe('/api/me');
  expect(routingPath('/caf%C3%A9')).toBe('/café');
  expect(routingPath('/%2561pi/me')).toBe('/api/me');
  expect(routingPath('/api%2Fme')).toBe('/api%2Fme');
  expect(routingPath('/api%3Fme')).toBe('/api%3Fme');
  for (const malformed of ['/bad%', '/bad%q0', '/bad%C0%AF']) {
    expect(() => routingPath(malformed)).toThrow(ConfigurationError);
  }
});

it('requires exact registration including explicit predicate mode and ordered patterns', () => {
  const patterns = { kind: 'patterns', patterns: ['/api/**'] } as const;
  assertRegistration(patterns, patterns);
  assertRegistration({ kind: 'predicate' }, { kind: 'predicate' });
  for (const registered of [
    { kind: 'unregistered' },
    { kind: 'predicate' },
    { kind: 'patterns', patterns: [] },
    { kind: 'patterns', patterns: ['/other/**'] },
  ] as const) {
    expect(() => assertRegistration(registered, patterns)).toThrow(ConfigurationError);
  }

  expect(() => assertRegistration(patterns, { kind: 'predicate' })).toThrow(ConfigurationError);
});

it('rejects excessive nested encoding rather than returning a partially decoded path', () => {
  expect(() => routingPath('/%' + '25'.repeat(12) + '61pi/me')).toThrow(ConfigurationError);
});
