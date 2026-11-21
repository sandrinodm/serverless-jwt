import { createJwtVerifier } from '../packages/jwt-verifier/src/index.ts';

/**
 * Isolate-global verifier deliberately reused across distinct workerd request events.
 */
let verifier;
export default {
  async fetch(request, env) {
    const input = JSON.parse(env.PORTABLE_INPUT);
    if (new URL(request.url).pathname === '/reset') {
      verifier = createJwtVerifier({
        issuer: input.issuer,
        audience: 'api',
        fetch: (url, init) => env.ISSUER.fetch(url, init),
        keys: { maxConcurrentFetches: 2 },
      });
      return Response.json({ reset: true });
    }

    try {
      const auth = await verifier.verify(input.token);
      return Response.json({ subject: auth.claims.sub });
    } catch (error) {
      return Response.json({ reason: error.reason }, { status: error.status ?? 500 });
    }
  },
};
