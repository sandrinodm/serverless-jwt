import { expect, it } from 'vite-plus/test';

import {
  defineConformanceSuite,
  runConformanceSuite,
} from '../../testkit/src/conformance/suite.ts';
import { nextCapabilities, proxyHarness, routeHarness } from './conformance.spec.ts';

defineConformanceSuite(routeHarness, nextCapabilities);
defineConformanceSuite(proxyHarness(), nextCapabilities);

it('detects a fail-open proxy even when the route independently rejects every invalid credential', async () => {
  const rows = await runConformanceSuite(
    proxyHarness(() => async () => undefined),
    { duplicateHeaders: true, streaming: true },
  );
  for (const name of [
    'missing',
    'basic',
    'empty-bearer',
    'comma',
    'oversize',
    'expired',
    'audience',
    'issuer',
    'signature',
    'none',
    'scopes-all',
    'scopes-challenge',
    'scopes-any-denied',
    'optional-invalid',
    'forged-preflight',
    'already-aborted',
    'jwks-outage',
    'discovery-mismatch',
  ]) {
    expect(rows.find((row) => row.case === name)?.result).toBe('fail');
  }

  expect(rows.find((row) => row.case === 'valid-mapping-forwarding')?.result).toBe('pass');
}, 20_000);
