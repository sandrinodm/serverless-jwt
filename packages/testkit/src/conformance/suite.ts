import { decodeJwt } from 'jose';
import assert from 'node:assert/strict';
import { afterAll, describe, it } from 'vite-plus/test';

import type { JwtVerifierOptions } from '../../../jwt-verifier/src/index.ts';
import type {
  AdapterHarness,
  Capabilities,
  CapabilityResult,
  RequestSpec,
  ResponseSpec,
  TestHandler,
  TestOptions,
} from './types.ts';

import { createJwtVerifier, ConfigurationError } from '../../../jwt-verifier/src/index.ts';
import { signingKey } from '../keys.ts';
import { mintToken } from '../tokens.ts';

/**
 * Independent public contract fixtures; never derive expectations from the serializer under test.
 */
const rejectionContracts = {
  /**
   * Missing credentials require a bare challenge.
   */
  missing_token: [401, 'missing_token', 'A bearer token is required.'],

  /**
   * Malformed bearer syntax uses the invalid-request contract.
   */
  malformed_header: [400, 'invalid_request', 'The authorization header is malformed.'],

  /**
   * Ambiguous credentials use the duplicate-specific fixed description.
   */
  multiple_credentials: [400, 'invalid_request', 'Multiple credentials are not allowed.'],

  /**
   * Oversized credentials remain invalid tokens.
   */
  token_too_large: [401, 'invalid_token', 'The token exceeds the size limit.'],

  /**
   * Expired credentials disclose only the fixed expiry description.
   */
  token_expired: [401, 'invalid_token', 'The token has expired.'],

  /**
   * An audience mismatch uses the fixed public audience description.
   */
  claim_audience: [401, 'invalid_token', 'The token audience is invalid.'],

  /**
   * An issuer mismatch uses the fixed public issuer description.
   */
  claim_issuer: [401, 'invalid_token', 'The token issuer is invalid.'],

  /**
   * A bad signature uses the fixed public signature description.
   */
  signature_invalid: [401, 'invalid_token', 'The token signature is invalid.'],

  /**
   * Unsigned tokens use the forbidden-algorithm description.
   */
  unsupported_algorithm: [401, 'invalid_token', 'The signing algorithm is not allowed.'],

  /**
   * Invalid compact serialization uses the malformed-token description.
   */
  malformed_token: [401, 'invalid_token', 'The token is malformed.'],

  /**
   * Scope refusals include the configured scope challenge.
   */
  insufficient_scope: [403, 'insufficient_scope', 'The token has insufficient scope.'],

  /**
   * Caller cancellation is a retryable refusal without a bearer challenge.
   */
  request_aborted: [503, 'temporarily_unavailable', 'The verification request was aborted.'],

  /**
   * Key outages are retryable without a bearer challenge.
   */
  jwks_unavailable: [503, 'temporarily_unavailable', 'Signing keys are unavailable.'],

  /**
   * Mismatched discovery is retryable without a bearer challenge.
   */
  discovery_invalid: [503, 'temporarily_unavailable', 'Issuer discovery is invalid.'],
} as const;

/**
 * Checks the entire fixed body and applicable challenge, including challenge absence on outages.
 */
function assertRejection(
  response: ResponseSpec,
  reason: keyof typeof rejectionContracts,
  scopes: ReadonlyArray<string> = [],
): void {
  const [status, code, description] = rejectionContracts[reason];
  assert.equal(response.status, status);
  assert.deepEqual(JSON.parse(response.body), { error: code, error_description: description });
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['content-type']?.split(';')[0], 'application/json');
  const challenge = {
    missing_token: 'Bearer realm="api"',
    invalid_request: 'Bearer error="invalid_request"',
    invalid_token: `Bearer error="invalid_token", error_description="${description}"`,
    insufficient_scope: `Bearer error="insufficient_scope", scope="${scopes.join(' ')}"`,
    temporarily_unavailable: undefined,
  }[code];
  assert.equal(response.headers['www-authenticate'], challenge);
  assert.equal(response.headers['retry-after'], status === 503 ? '1' : undefined);
}

/**
 * Exercises mandatory semantics and the two explicitly documented transport capabilities.
 */
export async function runConformanceSuite(
  harness: AdapterHarness,
  capabilities: Capabilities,
): Promise<ReadonlyArray<CapabilityResult>> {
  const rows: CapabilityResult[] = [];
  const key = await signingKey();
  const issuer = 'https://issuer.example';
  const payload = {
    iss: issuer,
    aud: 'api',
    sub: 'secret-subject',
    scope: 'read write',
    exp: Math.floor(Date.now() / 1000) + 300,
  };
  const token = await mintToken({ header: {}, payload, key });
  const base: JwtVerifierOptions<unknown> = {
    issuer,
    audience: 'api',
    jwksUri: issuer + '/jwks',
    fetch: async (): Promise<Response> => Response.json({ keys: [key.jwk] }),
    mapClaims: (claims) => ({ user: claims.sub }),
  };
  /**
   * Builds one credential-bearing request without bypassing platform extraction.
   */
  const request = (value = token): RequestSpec => ({
    headers: [['authorization', `Bearer ${value}`]],
  });
  /**
   * Echoes only noncredential auth fields to prove request ownership and forwarding.
   */
  const echo: TestHandler = (auth, forwarded) =>
    Response.json({
      sub: auth?.claims.sub,
      identity: auth?.identity,
      scopes: auth?.scopes,
      auth: auth === null ? 'null' : auth === undefined ? 'undefined' : 'present',
      forwarded,
    });
  /**
   * Retains failed rows so reporting cannot hide a mandatory semantic failure.
   */
  const check = async (name: string, run: () => Promise<void>): Promise<void> => {
    try {
      await run();
      rows.push({ entrypoint: harness.name, case: name, result: 'pass' });
    } catch {
      rows.push({ entrypoint: harness.name, case: name, result: 'fail' });
    }
  };
  /**
   * Requires safe responses and proves rejection never reaches the protected handler.
   */
  const rejection = async (
    options: TestOptions,
    spec: RequestSpec,
    reason: keyof typeof rejectionContracts,
  ): Promise<void> => {
    let called = false;
    await using app = await harness.setup(options, () => {
      called = true;
      return Response.json({});
    });
    const response = await app.send(spec);
    assert.equal(called, false);
    assertRejection(response, reason, options.scopes);
    const credential =
      spec.headers
        ?.find(([name]) => name.toLowerCase() === 'authorization')?.[1]
        .replace(/^Bearer +/, '')
        .split(',')[0] ?? '';
    const claimValues =
      credential.split('.').length === 3
        ? Object.values(decodeJwt(credential))
        : Object.values(payload);
    for (const value of [token, ...claimValues]) {
      assert.ok(!response.body.includes(String(value)));
    }
  };
  for (const [name, value, reason] of [
    ['missing', undefined, 'missing_token'],
    ['basic', 'Basic x', 'missing_token'],
    ['empty-bearer', 'Bearer', 'malformed_header'],
    ['comma', `Bearer ${token}, Bearer ${token}`, 'multiple_credentials'],
    ['oversize', 'Bearer ' + 'x'.repeat(9000), 'token_too_large'],
  ] as const) {
    await check(name, () =>
      rejection(base, { headers: value === undefined ? [] : [['authorization', value]] }, reason),
    );
  }

  await check('valid-mapping-forwarding', async () => {
    await using app = await harness.setup(base, echo);
    const response = await app.send(request());
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), {
      sub: payload.sub,
      identity: { user: payload.sub },
      scopes: ['read', 'write'],
      auth: 'present',
      forwarded: {
        env: 'test-env',
        ctx: 'test-ctx',
        params: 'test-params',
        context: 'test-context',
      },
    });
  });
  for (const [name, changes, reason] of [
    ['expired', { exp: 1 }, 'token_expired'],
    ['audience', { aud: 'hostile-audience' }, 'claim_audience'],
    ['issuer', { iss: 'hostile-issuer' }, 'claim_issuer'],
  ] as const) {
    await check(name, async () =>
      rejection(
        base,
        request(await mintToken({ header: {}, payload: { ...payload, ...changes }, key })),
        reason,
      ),
    );
  }

  await check('signature', async () =>
    rejection(
      base,
      request(await mintToken({ header: {}, payload, key: await signingKey('RS256', 'other') })),
      'signature_invalid',
    ),
  );
  await check('none', () =>
    rejection(
      base,
      request(
        Buffer.from('{"alg":"none"}').toString('base64url') +
          '.' +
          Buffer.from(JSON.stringify(payload)).toString('base64url') +
          '.x',
      ),
      'unsupported_algorithm',
    ),
  );
  await check('scopes-all', () =>
    rejection({ ...base, scopes: ['read', 'admin'] }, request(), 'insufficient_scope'),
  );
  await check('scopes-challenge', async () => {
    await using app = await harness.setup({ ...base, scopes: ['admin'] }, echo);
    const response = await app.send(request());
    assertRejection(response, 'insufficient_scope', ['admin']);
  });
  await check('scopes-any', async () => {
    await using app = await harness.setup(
      { ...base, scopes: ['admin', 'read'], scopeMode: 'any' },
      echo,
    );
    assert.equal((await app.send(request())).status, 200);
  });
  await check('scopes-any-denied', () =>
    rejection(
      { ...base, scopes: ['admin', 'manage'], scopeMode: 'any' },
      request(),
      'insufficient_scope',
    ),
  );
  await check('scopes-all-valid', async () => {
    await using app = await harness.setup({ ...base, scopes: ['read', 'write'] }, echo);
    assert.equal((await app.send(request())).status, 200);
  });
  await check('optional-missing', async () => {
    await using app = await harness.setup({ ...base, mode: 'optional' }, echo);
    assert.equal(JSON.parse((await app.send({})).body).auth, 'null');
  });
  await check('optional-invalid', () =>
    rejection({ ...base, mode: 'optional' }, request('invalid'), 'malformed_token'),
  );
  await check('forged-preflight', () =>
    rejection(
      base,
      { method: 'OPTIONS', headers: [['access-control-request-method', 'GET']] },
      'missing_token',
    ),
  );
  await check('skip-before-credentials', async () => {
    await using app = await harness.setup({ ...base, skip: () => true }, echo);
    assert.equal(
      JSON.parse((await app.send({ headers: [['authorization', 'Bearer x, y']] })).body).auth,
      'undefined',
    );
  });
  await check('already-aborted', async () =>
    rejection(base, { ...request(), signal: AbortSignal.abort() }, 'request_aborted'),
  );
  await check('abort-shared-fetch', async () => {
    let release: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    let fetches = 0;
    const controller = new AbortController();
    await using app = await harness.setup(
      {
        ...base,
        fetch: async (): Promise<Response> => {
          fetches++;
          started?.();
          await waiting;
          return Response.json({ keys: [key.jwk] });
        },
      },
      echo,
    );
    const first = app.send({ ...request(), signal: controller.signal });
    const second = app.send(request());
    await entered;
    const before = performance.now();
    controller.abort();
    try {
      assertRejection(await first, 'request_aborted');
      assert.ok(performance.now() - before < 50);
    } finally {
      release?.();
      assert.equal((await second).status, 200);
    }

    assert.equal(
      fetches,
      (harness.ioOwnership === 'request' ? 2 : 1) + (harness.verificationStages ?? 1) - 1,
    );
  });
  await check('configuration-conflict', async () => {
    await assert.rejects(
      () =>
        harness.setup(
          { ...base, verifier: createJwtVerifier(base) } as unknown as TestOptions,
          echo,
        ),
      ConfigurationError,
    );
  });
  await check('onError-async-response', async () => {
    await using app = await harness.setup(
      {
        ...base,
        onError: async () => {
          await Promise.resolve();
          return new Response('custom', { status: 418 });
        },
      },
      echo,
    );
    assert.equal((await app.send({})).body, 'custom');
  });
  for (const failure of [
    'throw',
    'reject',
    'unusable',
    'consumed',
    'locked',
    'undefined',
  ] as const) {
    await check('onError-' + failure, async () => {
      const events: unknown[] = [];
      /**
       * Exercises error-hook fallback with unusable and rejected custom results.
       */
      const onError = async (): Promise<unknown> => {
        if (failure === 'throw') {
          throw 'private-hook-secret';
        }

        if (failure === 'reject') {
          return Promise.reject(null);
        }

        if (failure === 'unusable') {
          return {};
        }

        if (failure === 'consumed') {
          const response = new Response('used');
          await response.text();
          return response;
        }

        if (failure === 'locked') {
          const response = new Response('locked');
          response.body?.getReader();
          return response;
        }

        return undefined;
      };
      await rejection(
        { ...base, onError, onIntegrationDiagnostic: (event) => events.push(event) },
        {},
        'missing_token',
      );
      assert.deepEqual(
        events,
        failure === 'undefined' ? [] : [{ type: 'integration.on_error_failed' }],
      );
    });
  }

  for (const observer of ['throw', 'reject'] as const) {
    await check('existing-verifier-observer-' + observer, async () => {
      let observed = false;
      await rejection(
        {
          verifier: createJwtVerifier(base),
          onError: () => {
            throw null;
          },
          onIntegrationDiagnostic: () => {
            observed = true;
            if (observer === 'throw') {
              throw null;
            }

            return Promise.reject('private-observer');
          },
        },
        {},
        'missing_token',
      );
      assert.equal(observed, true);
    });
  }

  await check('jwks-outage', () =>
    rejection(
      { ...base, fetch: async () => new Response(null, { status: 503 }) },
      request(),
      'jwks_unavailable',
    ),
  );
  await check('discovery-mismatch', () =>
    rejection(
      {
        issuer,
        audience: 'api',
        fetch: async () =>
          Response.json({ issuer: 'https://hostile.example', jwks_uri: issuer + '/jwks' }),
      },
      request(),
      'discovery_invalid',
    ),
  );
  await check('handler-error', async () => {
    const error = new Error('application failure');
    await using app = await harness.setup(base, () => {
      throw error;
    });
    await assert.rejects(
      () => app.send(request()),
      (cause) => cause === error,
    );
  });
  await check('isolation-200', async () => {
    await using app = await harness.setup(base, echo);
    if (harness.ioOwnership === 'request') {
      // Workerd deliberately bounds cold independent I/O; identity isolation uses warmed keys.
      assert.equal((await app.send(request())).status, 200);
    }

    const credentials = await Promise.all(
      Array.from({ length: 200 }, (_, index) =>
        mintToken({ header: {}, payload: { ...payload, sub: `identity-${index}` }, key }),
      ),
    );
    for (let round = 0; round < 2; round++) {
      const responses = await Promise.all(
        credentials.map((credential) => app.send(request(credential))),
      );
      responses.forEach((response, index) => {
        assert.equal(response.status, 200);
        assert.equal(JSON.parse(response.body).sub, `identity-${index}`);
      });
    }
  });
  for (const feature of ['duplicateHeaders', 'streaming'] as const) {
    const capability = capabilities[feature];
    if (capability !== true) {
      assert.ok(capability.reason.trim() && capability.guarantee.trim());
      rows.push({
        entrypoint: harness.name,
        case: feature,
        result: 'skip',
        reason: capability.reason + '; lost guarantee: ' + capability.guarantee,
      });
      continue;
    }

    await check(feature, async () => {
      if (feature === 'duplicateHeaders') {
        for (const values of [
          [token, 'invalid'],
          ['invalid', token],
        ]) {
          await rejection(
            base,
            { headers: values.map((value) => ['authorization', 'Bearer ' + value] as const) },
            'multiple_credentials',
          );
        }
      } else {
        let release: (() => void) | undefined;
        const released = new Promise<void>((resolve) => {
          release = resolve;
        });
        let prefix = '';
        let forcedRelease = false;
        let finishVerification: (() => void) | undefined;
        const verificationGate = new Promise<void>((resolve) => {
          finishVerification = resolve;
        });
        let markVerifying: (() => void) | undefined;
        const verifying = new Promise<void>((resolve) => {
          markVerifying = resolve;
        });
        let handlerCalled = false;
        await using app = await harness.setup(
          {
            ...base,
            fetch: async (): Promise<Response> => {
              markVerifying?.();
              await verificationGate;
              return Response.json({ keys: [key.jwk] });
            },
          },
          () => {
            handlerCalled = true;
            return new Response(
              new ReadableStream({
                async start(controller): Promise<void> {
                  controller.enqueue(new TextEncoder().encode('first-'));
                  await released;
                  controller.enqueue(new TextEncoder().encode('second'));
                  controller.close();
                },
              }),
            );
          },
        );
        assert.ok(app.stream, 'Streaming capability requires incremental response observation');
        const timer = setTimeout(() => {
          forcedRelease = true;
          finishVerification?.();
          release?.();
        }, 1000);
        let pending: Promise<ResponseSpec> | undefined;
        try {
          pending = app.stream(request(), (chunk) => {
            if (prefix.length < 6) {
              assert.equal(
                forcedRelease,
                false,
                'No bytes arrived before the stream completion gate',
              );
              prefix += chunk;
              if (prefix.length >= 6) {
                assert.equal(prefix, 'first-');
                release?.();
              }
            }
          });
          await verifying;
          assert.equal(handlerCalled, false, 'Handler ran before verification completed');
          assert.equal(prefix, '', 'Response bytes arrived before verification completed');
          finishVerification?.();
          const response = await pending;
          assert.equal(prefix, 'first-');
          assert.equal(response.body, 'first-second');
        } finally {
          clearTimeout(timer);
          finishVerification?.();
          release?.();
          await pending?.catch(() => {});
        }
      }
    });
  }

  return rows;
}

/**
 * Registers the suite and emits an auditable table and JSON artifact even for failed cases.
 */
export function defineConformanceSuite(
  harness: AdapterHarness,
  capabilities: Capabilities,
  reportResults?: (results: ReadonlyArray<CapabilityResult>) => Promise<void>,
): void {
  describe(harness.name, () => {
    let results: ReadonlyArray<CapabilityResult> = [];
    it('passes every mandatory authentication case', async () => {
      results = await runConformanceSuite(harness, capabilities);
      assert.deepEqual(
        results.filter((row) => row.result === 'fail'),
        [],
      );
    }, 20_000);
    afterAll(async () => {
      if (reportResults) {
        await reportResults(results);
        return;
      }

      const { mkdirSync, writeFileSync } = await import('node:fs');
      const directory = process.env.CONFORMANCE_REPORT_DIRECTORY ?? 'reports/conformance';
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        `${directory}/${harness.name.replaceAll('/', '-')}.json`,
        JSON.stringify(results, null, 2) + '\n',
      );
    });
  });
}
