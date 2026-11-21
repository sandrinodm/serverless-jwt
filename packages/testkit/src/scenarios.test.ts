import { createLocalJWKSet, decodeJwt, jwtVerify } from 'jose';
import assert from 'node:assert/strict';
import { createPublicKey } from 'node:crypto';
import { expect, test } from 'vite-plus/test';

import type { Driver, DriverDiagnostic, DriverOptions } from './drivers/types.ts';
import type { IssuerScript } from './issuer.ts';
import type { Observation, Scenario, ScenarioContext } from './scenarios/index.ts';

import { issuerTransport } from './issuer.ts';
import { fixtureKey } from './keys.ts';
import { scenarios } from './scenarios/index.ts';
import { token } from './scenarios/token.ts';

/**
 * Finds a real catalogue definition, so contract tests cannot substitute a parallel scenario.
 */
function scenario(id: string): Scenario {
  const found = scenarios.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`unknown scenario ${id}`);
  }

  return found;
}

/**
 * Checks required fields and numeric bounds against the scenario expectation.
 */
function assertExpected(actual: Observation, expected: Scenario['expected']): void {
  const { limits, ...fields } = expected;
  expect(actual).toMatchObject(fields);
  for (const [fact, maximum] of Object.entries(limits ?? {})) {
    expect(typeof actual.facts?.[fact]).toBe('number');
    expect(actual.facts?.[fact]).toBeLessThanOrEqual(maximum);
  }
}

/**
 * Supplies an in-memory issuer and clock; only alternate-origin discovery listeners use real I/O.
 */
function fixture(): ScenarioContext & { readonly reply: IssuerScript } {
  let now = 1_800_000_000_000;
  const key = fixtureKey(2048);
  const hits: Record<string, number> = {};
  let script: IssuerScript = (path) => ({
    json: path.startsWith('/.well-known')
      ? { issuer: 'https://issuer.test', jwks_uri: 'https://issuer.test/jwks' }
      : { keys: [key.jwk] },
  });
  const driver: Driver = {
    create: () => {},
    verify: async () => ({}),
    extract: (header) => header,
    helpers: {
      removeNamespaces: () => Object.create(null) as Record<string, unknown>,
      claimToArray: () => [],
    },
    respond: async () => ({ status: 401, body: '{"error":"invalid_token"}' }),
    diagnostics: () => [],
  };
  return {
    key,
    driver,
    issuer: {
      url: 'https://issuer.test',
      hits,
      maxConcurrent: {},
      setScript: (next) => {
        script = next;
      },
      close: async () => {},
      [Symbol.asyncDispose]: async () => {},
    },
    clock: {
      now: () => now,
      advance: async (milliseconds) => {
        now += milliseconds;
      },
      close: () => {},
      pendingTimers: () => 0,
    },
    observe: async (operation) => {
      try {
        return { outcome: 'accepted', value: await operation() };
      } catch (error) {
        const failure = error as { code?: string; reason?: string; status?: number };
        return { outcome: 'rejected', ...failure };
      }
    },
    reply: (path, hit) => script(path, hit),
  };
}

/**
 * Adapts jose's multiple-match error to the private rejection contract for this one fixture.
 */
const ambiguousFailure = { code: 'temporarily_unavailable', reason: 'jwks_invalid', status: 503 };

test('duplicate kid uses two distinct eligible keys and reports ambiguity in both orders', async () => {
  const context = fixture();
  const moduli: string[] = [];
  const driver: Driver = {
    ...context.driver,
    verify: async (jwt) => {
      const { keys } = context.reply('/jwks', 1).json as { keys: Record<string, unknown>[] };
      for (const key of keys) {
        expect(
          createPublicKey({ key, format: 'jwk' }).asymmetricKeyDetails?.modulusLength,
        ).toBeGreaterThanOrEqual(2048);
        moduli.push(key.n as string);
      }

      try {
        return await jwtVerify(jwt, createLocalJWKSet({ keys }), {
          currentDate: new Date(context.clock.now()),
        });
      } catch (error) {
        assert.equal((error as { code: string }).code, 'ERR_JWKS_MULTIPLE_MATCHING_KEYS');
        throw ambiguousFailure;
      }
    },
  };
  const entry = scenario('keys.duplicate-kid');
  assertExpected(await entry.run({ ...context, driver }), entry.expected);
  expect(new Set(moduli).size).toBe(2);
});

test('discarding an undersized duplicate leaves one eligible signing key', async () => {
  const context = fixture();
  const keys = [context.key.jwk, fixtureKey(1024).jwk];
  const eligible = keys.filter(
    (key) =>
      (createPublicKey({ key, format: 'jwk' }).asymmetricKeyDetails?.modulusLength ?? 0) >= 2048,
  );
  expect(eligible).toHaveLength(1);
  const verified = await jwtVerify(await token(context), createLocalJWKSet({ keys: eligible }), {
    currentDate: new Date(context.clock.now()),
  });
  expect(verified.payload.sub).toBe('subject');
});

test.each(['keys.unknown-kid-flood-then-rotation', 'keys.expired-key-after-flood'])(
  '%s requires fresh material and a bounded fetch, rejecting a never-refresh cache',
  async (id) => {
    const entry = scenario(id);
    for (const refresh of [true, false]) {
      const context = fixture();
      let cached: ReturnType<typeof createLocalJWKSet> | undefined;
      let fetchedAt = -Infinity;
      const driver: Driver = {
        ...context.driver,
        verify: async (jwt) => {
          // A small fake boundary: refresh at the scenario's two explicit schedule points only.
          // jose still checks the actual signature against the captured issuer key material.
          if (!cached || (refresh && context.clock.now() - fetchedAt >= 30_000)) {
            fetchedAt = context.clock.now();
            context.issuer.hits['/jwks'] = (context.issuer.hits['/jwks'] ?? 0) + 1;
            cached = createLocalJWKSet(
              context.reply('/jwks', context.issuer.hits['/jwks']).json as Parameters<
                typeof createLocalJWKSet
              >[0],
            );
          }

          return (await jwtVerify(jwt, cached, { currentDate: new Date(context.clock.now()) }))
            .payload;
        },
      };
      const actual = await entry.run({ ...context, driver });
      if (refresh) {
        assertExpected(actual, entry.expected);
      } else {
        assert.throws(() => assertExpected(actual, entry.expected), /expected/);
        assert.equal(actual.outcome, 'rejected');
        assert.equal(actual.facts?.jwksFetches, 1);
      }
    }
  },
);

test('HTTP issuer rejection is observed at construction and distinguishes late rejection', async () => {
  const entry = scenario('discovery.http-issuer');
  for (const atConstruction of [true, false]) {
    const context = fixture();
    const driver: Driver = {
      ...context.driver,
      create: (options) => {
        if (atConstruction && options.issuer.startsWith('http:')) {
          throw new Error('invalid configuration');
        }
      },
      verify: async () => {
        throw new Error('late rejection');
      },
    };
    const actual = await entry.run({ ...context, driver });
    if (atConstruction) {
      assertExpected(actual, entry.expected);
    } else {
      assert.throws(() => assertExpected(actual, entry.expected), /expected/);
    }
  }
});

test('JWKS redirect has a JWKS reason and requires zero alternate-origin hits', async () => {
  const entry = scenario('discovery.redirect-to-other-origin');
  const transport = issuerTransport();
  try {
    for (const follow of [false, true]) {
      const context = fixture();
      const driver: Driver = {
        ...context.driver,
        verify: async () => {
          const reply = context.reply('/jwks', 1);
          expect(reply.redirect).toBeDefined();
          if (follow) {
            assert.ok(reply.redirect);
            await transport.fetch(reply.redirect);
          }

          throw { code: 'temporarily_unavailable', reason: 'jwks_unavailable', status: 503 };
        },
      };
      const actual = await entry.run({ ...context, driver });
      if (follow) {
        assert.throws(() => assertExpected(actual, entry.expected), /expected/);
        assert.equal(actual.facts?.alternateFetches, 1);
      } else {
        assertExpected(actual, entry.expected);
      }
    }
  } finally {
    await transport.close();
  }
});

test('safe namespace helper puts prototype measurements in facts', async () => {
  const context = fixture();
  const entry = scenario('namespaces.__proto__');
  const actual = await entry.run(context);
  assertExpected(actual, entry.expected);
  expect(actual.facts?.inheritedAdmin).toBe(false);
  const unsafe: Driver = {
    ...context.driver,
    helpers: {
      ...context.driver.helpers,
      removeNamespaces: () => Object.create({ admin: true }) as Record<string, unknown>,
    },
  };
  const awaited = await entry.run({ ...context, driver: unsafe });
  assert.throws(() => assertExpected(awaited, entry.expected), /expected/);
});

test.each(scenarios.filter((entry) => entry.id.startsWith('errors.reflected-')))(
  '$id captures a private diagnostic reason without adding it to HTTP',
  async (entry) => {
    const context = fixture();
    const diagnostics: DriverDiagnostic[] = [{ type: 'verify.rejected', reason: 'old-event' }];
    const response = {
      status: entry.expected.status ?? 500,
      body: JSON.stringify({ error: entry.expected.code }),
    };
    const driver: Driver = {
      ...context.driver,
      respond: async () => {
        diagnostics.push({
          type: 'verify.rejected',
          reason: entry.expected.reason ?? 'missing-reason',
        });
        return response;
      },
      diagnostics: () => diagnostics,
    };
    const actual = await entry.run({ ...context, driver });
    assertExpected(actual, entry.expected);
    expect(actual.http).toEqual(response);
    expect(response.body).not.toContain(entry.expected.reason ?? 'missing-reason');
    const noDiagnostic = await entry.run({
      ...context,
      driver: { ...driver, respond: async () => response },
    });
    assert.throws(() => assertExpected(noDiagnostic, entry.expected), /expected/);
  },
);

test('mapping keeps mapped identity separate from every original verified claim', async () => {
  const entry = scenario('mapping.returns-object');
  for (const shape of ['auth', 'raw-mapped', 'empty', 'merged']) {
    const context = fixture();
    let options: DriverOptions;
    const driver: Driver = {
      ...context.driver,
      create: (next) => {
        options = next;
      },
      verify: async (jwt) => {
        const claims = decodeJwt(jwt);
        const identity = await options.mapClaims?.(claims);
        if (shape === 'raw-mapped') {
          return identity;
        }

        if (shape === 'empty') {
          return {};
        }

        return {
          identity,
          claims: shape === 'merged' ? { ...claims, ...(identity as object) } : claims,
        };
      },
    };
    const actual = await entry.run({ ...context, driver });
    if (shape === 'auth') {
      assertExpected(actual, entry.expected);
    } else {
      assert.throws(() => assertExpected(actual, entry.expected), /expected/);
    }
  }
});

test('every scenario has a unique identifier', () => {
  const ids = scenarios.map((entry) => entry.id);
  expect(new Set(ids).size).toBe(ids.length);
});
