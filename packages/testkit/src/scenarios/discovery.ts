import type { Scenario } from './index.ts';

import { startIssuer } from '../issuer.ts';
import { token } from './token.ts';

/**
 * Proves issuer trust/downgrade checks, cache ownership, concurrency and semaphore recovery.
 */
export const discoveryScenarios: ReadonlyArray<Scenario> = [
  'first-fetch-fails-then-recovers',
  'concurrent-cold-start',
  'jwks-uri-changes',
  'issuer-mismatch',
  'http-jwks-uri',
  'http-issuer',
  'redirect-to-other-origin',
  'mutation-after-create',
].map((name) => ({
  id: name === 'mutation-after-create' ? 'config.mutation-after-create' : `discovery.${name}`,
  description: `discovery behavior ${name}`,
  owner: 'core',
  issuer: () => ({}),

  expected:
    name === 'http-issuer'
      ? { outcome: 'rejected', facts: { rejectionBoundary: 'configuration', issuerRequests: 0 } }
      : ['issuer-mismatch', 'http-jwks-uri', 'redirect-to-other-origin'].includes(name)
        ? {
            outcome: 'rejected',
            code: 'temporarily_unavailable',
            reason: name === 'redirect-to-other-origin' ? 'jwks_unavailable' : 'discovery_invalid',
            ...(['http-jwks-uri', 'redirect-to-other-origin'].includes(name)
              ? { facts: { alternateFetches: 0 } }
              : {}),
            status: 503,
          }
        : name === 'concurrent-cold-start'
          ? {
              outcome: 'accepted',
              facts: { discoveryFetches: 1, jwksFetches: 1, discoveryMaxConcurrent: 1 },
            }
          : name === 'first-fetch-fails-then-recovers'
            ? {
                outcome: 'accepted',
                facts: { first: 'rejected', third: 'accepted', discoveryFetches: 2 },
              }
            : name === 'jwks-uri-changes'
              ? {
                  outcome: 'accepted',
                  facts: {
                    first: 'accepted',
                    discoveryFetches: 2,
                    oldJwksFetches: 1,
                    newJwksFetches: 1,
                  },
                }
              : { outcome: 'accepted' },
  run: async (context) => {
    if (name === 'mutation-after-create') {
      const options = { issuer: context.issuer.url, audience: 'api' };
      context.driver.create(options);
      options.audience = 'changed';
      return context.observe(async () => context.driver.verify(await token(context)));
    }

    if (name === 'http-issuer' || name === 'http-jwks-uri' || name === 'redirect-to-other-origin') {
      await using alternate = await startIssuer({
        tls: name === 'redirect-to-other-origin',
        script: () => ({ json: { keys: [context.key.jwk] } }),
      });
      if (name === 'http-issuer') {
        alternate.setScript((path) => ({
          json: path.startsWith('/.well-known')
            ? { issuer: alternate.url, jwks_uri: `${alternate.url}/jwks` }
            : { keys: [context.key.jwk] },
        }));
        const jwt = await token(context, { iss: alternate.url });
        let boundary = 'configuration';
        const result = await context.observe(() => {
          context.driver.create({ issuer: alternate.url, audience: 'api' });
          boundary = 'verification';
          return context.driver.verify(jwt);
        });
        return {
          ...result,
          facts: {
            rejectionBoundary: result.outcome === 'rejected' ? boundary : 'none',
            issuerRequests: Object.values(alternate.hits).reduce((sum, hits) => sum + hits, 0),
          },
        };
      }

      context.issuer.setScript((path) =>
        path.startsWith('/.well-known')
          ? {
              json: {
                issuer: context.issuer.url,
                jwks_uri:
                  name === 'http-jwks-uri'
                    ? `${alternate.url.replace('127.0.0.1', 'legacy-issuer.test')}/jwks`
                    : `${context.issuer.url}/jwks`,
              },
            }
          : { redirect: `${alternate.url}/jwks` },
      );
      const result = await context.observe(async () => context.driver.verify(await token(context)));
      return { ...result, facts: { alternateFetches: alternate.hits['/jwks'] ?? 0 } };
    }

    if (name === 'issuer-mismatch') {
      context.issuer.setScript((path) => ({
        json: path.startsWith('/.well-known')
          ? { issuer: 'https://attacker.example', jwks_uri: `${context.issuer.url}/jwks` }
          : { keys: [context.key.jwk] },
      }));
      return context.observe(async () => context.driver.verify(await token(context)));
    }

    if (name === 'first-fetch-fails-then-recovers') {
      context.issuer.setScript((path, hit) =>
        path.startsWith('/.well-known') && hit === 1
          ? { status: 503 }
          : {
              json: path.startsWith('/.well-known')
                ? { issuer: context.issuer.url, jwks_uri: `${context.issuer.url}/jwks` }
                : {
                    keys: ['valid', 'second', 'third'].map((kid) => ({ ...context.key.jwk, kid })),
                  },
            },
      );
      const first = await context.observe(async () => context.driver.verify(await token(context)));
      await context.clock.advance(60_001);
      const second = await context.observe(async () =>
        context.driver.verify(await token(context, {}, { kid: 'second' })),
      );
      const third = await context.observe(async () =>
        context.driver.verify(await token(context, {}, { kid: 'third' })),
      );
      return {
        ...second,
        facts: {
          first: first.outcome,
          third: third.outcome,
          discoveryFetches: context.issuer.hits['/.well-known/openid-configuration'] ?? 0,
        },
      };
    }

    if (name === 'concurrent-cold-start') {
      context.issuer.setScript((path) => ({
        delay: path.startsWith('/.well-known') ? 1 : 0,
        json: path.startsWith('/.well-known')
          ? { issuer: context.issuer.url, jwks_uri: `${context.issuer.url}/jwks` }
          : {
              keys: Array.from({ length: 5 }, (_, index) => ({
                ...context.key.jwk,
                kid: `cold-${index}`,
              })),
            },
      }));
      const result = await context.observe(() =>
        Promise.all(
          Array.from({ length: 5 }, async (_, index) =>
            context.driver.verify(await token(context, {}, { kid: `cold-${index}` })),
          ),
        ),
      );
      return {
        ...result,
        facts: {
          discoveryFetches: context.issuer.hits['/.well-known/openid-configuration'] ?? 0,
          jwksFetches: context.issuer.hits['/jwks'] ?? 0,
          discoveryMaxConcurrent:
            context.issuer.maxConcurrent['/.well-known/openid-configuration'] ?? 0,
        },
      };
    }

    const first = await context.observe(async () => context.driver.verify(await token(context)));
    await context.clock.advance(24 * 60 * 60_000 + 1);
    context.issuer.setScript((path) => ({
      json: path.startsWith('/.well-known')
        ? { issuer: context.issuer.url, jwks_uri: `${context.issuer.url}/new-jwks` }
        : { keys: [{ ...context.key.jwk, kid: 'rotated' }] },
    }));
    const result = await context.observe(async () =>
      context.driver.verify(await token(context, {}, { kid: 'rotated' })),
    );
    return {
      ...result,
      facts: {
        first: first.outcome,
        discoveryFetches: context.issuer.hits['/.well-known/openid-configuration'] ?? 0,
        oldJwksFetches: context.issuer.hits['/jwks'] ?? 0,
        newJwksFetches: context.issuer.hits['/new-jwks'] ?? 0,
      },
    };
  },
}));
