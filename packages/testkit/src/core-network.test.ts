import { expect, test } from 'vite-plus/test';

import type { IssuerReply } from './issuer.ts';

import { createJwtVerifier } from '../../jwt-verifier/src/index.ts';
import { startIssuer, issuerTransport } from './issuer.ts';
import { fixtureKey } from './keys.ts';

/**
 * Resource-exhaustion fixtures are bounded by the one-second network policy plus TLS setup.
 */
const NETWORK_TIMEOUT_MILLIS = 4_000;

test.each([
  ['slow drip', { drip: 50, json: { keys: [fixtureKey(2048).jwk] } }, 'jwks_unavailable'],
  ['oversized', { megabytes: 2 }, 'jwks_invalid'],
  ['reset', { reset: true }, 'jwks_unavailable'],
  ['redirect', { redirect: 'https://attacker.invalid/' }, 'jwks_unavailable'],
] as const)(
  'bounded real HTTPS rejects %s',
  async (_name, reply, reason) => {
    await using issuer = await startIssuer({ script: () => reply as IssuerReply });
    const transport = issuerTransport();
    try {
      const verifier = createJwtVerifier({
        issuer: issuer.url,
        audience: 'api',
        jwksUri: `${issuer.url}/jwks`,
        fetch: transport.fetch as unknown as typeof globalThis.fetch,
        keys: { timeout: 1, maxResponseBytes: 1024 },
      });
      await expect(verifier.warmup()).rejects.toMatchObject({ reason });
      expect(issuer.hits['/jwks']).toBe(1);
    } finally {
      await transport.close();
    }
  },
  NETWORK_TIMEOUT_MILLIS,
);
