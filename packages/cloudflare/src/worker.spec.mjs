import { createJwtVerifier } from '../../jwt-verifier/src/index.ts';
import { withJwt } from './index.ts';

/**
 * Isolate-global state deliberately spans real request events for the native I/O ownership probe.
 */
let guarded;
/**
 * Counts independent request-owned JWKS fetches before the deliberate fixture outage.
 */
let calls = 0;
/**
 * Distinct request scopes that actually enter the fetch extension.
 */
const owners = new Set();
/**
 * Valid synthetic credential configured by the native conformance fixture.
 */
let credential;

export default {
  async fetch(request, environment, context) {
    const path = new URL(request.url).pathname;
    if (path === '/reset') {
      calls = 0;
      owners.clear();
      const { token, jwk } = await request.json();
      credential = token;
      const verifier = createJwtVerifier({
        issuer: 'https://issuer.example',
        audience: 'api',
        jwksUri: 'https://issuer.example/jwks',
        keys: { maxConcurrentFetches: 2 },
        fetch: async () => {
          const currentOwner = crypto.randomUUID();
          calls++;
          owners.add(currentOwner);
          return environment.REPORT.fetch('https://report.test/jwks', {
            method: 'POST',
            body: JSON.stringify({ keys: [jwk], owner: currentOwner }),
          });
        },
      });
      guarded = withJwt({ verifier }, (_request, _environment, _context, auth) =>
        Response.json({ subject: auth.claims.sub }),
      );
      return Response.json({ reset: true });
    }

    if (path === '/facts') {
      return Response.json({ calls, owners: owners.size });
    }

    const authenticated = new Request(request, {
      headers: { authorization: 'Bearer ' + credential },
    });
    const response = await guarded(authenticated, environment, context);
    return response;
  },
};
