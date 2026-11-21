import {
  createJwtVerifier,
  getBearerToken,
  hasScopes,
  JwtVerifierError,
  removeNamespaces,
} from '../index.ts';

/**
 * External issuer credentials supplied by the Node parent, never a server inside the runtime.
 */
export interface PortableInput {
  /**
   * Verified HTTPS fixture issuer.
   */
  readonly issuer: string;
  /**
   * Valid signed access token minted outside the runtime.
   */
  readonly token: string;
  /**
   * Expired but correctly signed token.
   */
  readonly expired: string;
}

/**
 * Minimal test registration accepted by Vitest, Deno and Bun without platform imports.
 */
export type Register = (name: string, run: () => Promise<void>) => void;

/**
 * Throws a portable assertion failure without importing Node assertion helpers.
 */
function assert(condition: unknown, description: string): asserts condition {
  if (!condition) {
    throw new Error(description);
  }
}

/**
 * Registers one shared portable suite using actual runtime fetch and WebCrypto.
 */
export function portableSuite(
  input: PortableInput,
  register: Register,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): void {
  register(
    'verifies over HTTPS, freezes signed claims and keeps scope and mapping separate',
    async () => {
      const verifier = createJwtVerifier({
        issuer: input.issuer,
        audience: 'api',
        fetch: fetcher,
        mapClaims: (claims) => ({ id: claims.sub }),
      });
      await verifier.warmup();
      const auth = await verifier.verify(input.token);
      assert(auth.claims.sub === 'portable', 'verified subject');
      assert(auth.identity.id === 'portable', 'mapped identity');
      assert(Object.isFrozen(auth.claims), 'frozen claims');
      assert(Object.getPrototypeOf(auth.claims) === null, 'null prototype');
      assert(hasScopes(auth, ['read']), 'verified scopes');
      const again = await verifier.verify(input.token);
      assert(again.claims.sub === 'portable', 'warm cache');
    },
  );
  register(
    'rejects expiration, tampering and oversized tokens with safe typed errors',
    async () => {
      const verifier = createJwtVerifier({ issuer: input.issuer, audience: 'api', fetch: fetcher });
      for (const [token, reason] of [
        [input.expired, 'token_expired'],
        [input.token.slice(0, -8) + 'AAAAAAAA', 'signature_invalid'],
        ['x'.repeat(8193), 'token_too_large'],
      ] as const) {
        let failure: unknown;
        try {
          await verifier.verify(token);
        } catch (error) {
          failure = error;
        }

        assert(failure instanceof JwtVerifierError, 'typed rejection');
        assert(failure.reason === reason, reason);
        assert(!JSON.stringify(failure).includes(token), 'no credential serialization');
      }
    },
  );
  register('shares deterministic bearer and namespace helper semantics', async () => {
    const parsed = getBearerToken(['bearer  abc']);
    assert(parsed.ok && parsed.token === 'abc', 'bearer parse');
    assert(!getBearerToken('Bearer abc\r').ok, 'control rejection');
    const claims = removeNamespaces(
      { 'https://claims.test/name': 'portable', 'https://claims.test/__proto__': true },
      'https://claims.test/',
    );
    assert(claims.name === 'portable', 'namespace prefix');
    assert(Object.getPrototypeOf(claims) === null, 'helper prototype');
  });
  register('enforces overall deadline against an extension that ignores abort', async () => {
    const verifier = createJwtVerifier({
      issuer: input.issuer,
      audience: 'api',
      verifyTimeout: 1,
      fetch: () => new Promise<Response>(() => {}),
    });
    const start = Date.now();
    let failure: unknown;
    try {
      await verifier.verify(input.token);
    } catch (error) {
      failure = error;
    }

    assert(
      failure instanceof JwtVerifierError && failure.reason === 'deadline_exceeded',
      'deadline',
    );
    assert(Date.now() - start < 2000, 'finite deadline');
  });
}
