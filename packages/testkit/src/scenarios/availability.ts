import type { Scenario } from './index.ts';

import { drainIo } from '../clock.ts';
import { signingKey } from '../keys.ts';
import { mintToken } from '../tokens.ts';
import { token } from './token.ts';

/**
 * Measures limiter completion distributions and denial of rotated/expired keys after unknown-kid
 * floods.
 */
export const availabilityScenarios: ReadonlyArray<Scenario> = [
  'unknown-kid-flood-then-rotation',
  'limiter-burst-1000',
  'expired-key-after-flood',
  'reflected-alg',
  'reflected-iss',
  'reflected-aud',
  'reflected-kid',
  'reflected-jwks-url',
].map((name) => ({
  id: name.startsWith('reflected') ? `errors.${name}` : `keys.${name}`,
  description: `black-box ${name}`,

  owner: name.startsWith('reflected') ? 'adapter' : 'core',
  issuer: () => ({}),

  expected: name.startsWith('reflected')
    ? {
        outcome: 'rejected',
        code: name === 'reflected-jwks-url' ? 'temporarily_unavailable' : 'invalid_token',
        reason:
          name === 'reflected-alg'
            ? 'unsupported_algorithm'
            : name === 'reflected-iss'
              ? 'claim_issuer'
              : name === 'reflected-aud'
                ? 'claim_audience'
                : name === 'reflected-kid'
                  ? 'key_not_found'
                  : 'jwks_unavailable',
        status: name === 'reflected-jwks-url' ? 503 : 401,
        facts: { reflectsMarker: false },
      }
    : name === 'limiter-burst-1000'
      ? {
          outcome: 'rejected',
          facts: { completed: 1000, accepted: 0 },
          limits: { maxFakeMillis: 1000, jwksFetches: 1 },
        }
      : {
          outcome: 'accepted',
          facts: {
            floodCompleted: 10,
            floodAccepted: 0,
            jwksFetches: 2,
            ...(name === 'expired-key-after-flood' ? { warmed: 'accepted' } : {}),
          },
          limits: { floodJwksFetches: 1 },
        },
  run: async (context) => {
    if (name.startsWith('reflected')) {
      const marker = 'INJECTED_ATTACKER_VALUE';
      const field = name.slice('reflected-'.length);
      if (field === 'jwks-url') {
        context.issuer.setScript((path) =>
          path.startsWith('/.well-known')
            ? { json: { issuer: context.issuer.url, jwks_uri: `${context.issuer.url}/${marker}` } }
            : { status: 503 },
        );
      }

      const jwt = await token(
        context,
        field === 'iss' || field === 'aud' ? { [field]: marker } : {},
        field === 'alg' || field === 'kid' ? { [field]: marker } : {},
      );
      const diagnosticStart = context.driver.diagnostics().length;
      const response = await context.driver.respond(jwt, {
        issuer: context.issuer.url,
        audience: 'api',
      });
      const rejection = context.driver
        .diagnostics()
        .slice(diagnosticStart)
        .findLast((event) => event.type === 'verify.rejected');
      return {
        outcome: 'rejected',
        ...(rejection?.reason ? { reason: rejection.reason } : {}),
        code: (JSON.parse(response.body) as { error: string }).error,
        http: response,
        status: response.status,
        facts: { reflectsMarker: response.body.includes(marker) },
      };
    }

    const replacement =
      name === 'limiter-burst-1000'
        ? context.key
        : await signingKey('RS256', name === 'expired-key-after-flood' ? 'valid' : 'rotated');
    let warmed: string | undefined;
    if (name === 'expired-key-after-flood') {
      warmed = (await context.observe(async () => context.driver.verify(await token(context))))
        .outcome;
      await context.clock.advance(10 * 60_000 + 1);
      context.issuer.setScript((path) => ({
        json: path.startsWith('/.well-known')
          ? { issuer: context.issuer.url, jwks_uri: `${context.issuer.url}/jwks` }
          : { keys: [replacement.jwk] },
      }));
    }

    const beforeFloodFetches = context.issuer.hits['/jwks'] ?? 0;
    const count = name === 'limiter-burst-1000' ? 1000 : 10;
    const start = context.clock.now();
    const completions: number[] = [];
    const outcomes: string[] = [];
    const batch = await Promise.all(
      Array.from({ length: count }, async (_, index) => {
        const jwt = await token(context, {}, { kid: `unknown-${index}` });
        return { jwt };
      }),
    );
    const pending = batch.map(({ jwt }) =>
      context.driver.verify(jwt).then(
        () => {
          outcomes.push('accepted');
          completions.push(context.clock.now() - start);
        },
        () => {
          outcomes.push('rejected');
          completions.push(context.clock.now() - start);
        },
      ),
    );
    // Yield real I/O without spending simulated cooldown time; the child watchdog bounds this wait.
    while (completions.length < Math.min(10, count)) {
      await drainIo(2);
    }

    const completedAtZero = completions.length;
    for (let minute = 0; minute < 110 && completions.length < count; minute++) {
      await context.clock.advance(60_001);
      const target = Math.min(count, (minute + 2) * 10);
      while (completions.length < target) {
        await drainIo(2);
      }
    }

    if (completions.length !== count) {
      throw new Error(`limiter did not settle all ${count} requests within 110 fake minutes`);
    }

    await Promise.all(pending);
    if (name === 'limiter-burst-1000') {
      return {
        outcome: 'rejected',
        facts: {
          completed: completions.length,
          accepted: outcomes.filter((outcome) => outcome === 'accepted').length,
          completedAtZero,
          maxFakeMillis: Math.max(...completions),
          jwksFetches: context.issuer.hits['/jwks'] ?? 0,
        },
      };
    }

    const floodJwksFetches = (context.issuer.hits['/jwks'] ?? 0) - beforeFloodFetches;
    if (name === 'unknown-kid-flood-then-rotation') {
      context.issuer.setScript((path) => ({
        json: path.startsWith('/.well-known')
          ? { issuer: context.issuer.url, jwks_uri: `${context.issuer.url}/jwks` }
          : { keys: [replacement.jwk] },
      }));
      await context.clock.advance(30_001);
    }

    const jwt = await mintToken({
      key: replacement,
      header: { kid: replacement.jwk.kid },
      payload: {
        iss: context.issuer.url,
        aud: 'api',
        exp: Math.floor(context.clock.now() / 1000) + 300,
      },
    });
    const result = await context.observe(() => context.driver.verify(jwt));
    return {
      ...result,
      facts: {
        ...(warmed ? { warmed } : {}),
        floodCompleted: completions.length,
        floodAccepted: outcomes.filter((outcome) => outcome === 'accepted').length,
        floodJwksFetches,
        jwksFetches: context.issuer.hits['/jwks'] ?? 0,
      },
    };
  },
}));
