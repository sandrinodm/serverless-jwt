import { mkdtempDisposableSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';

import { fixtureKey } from '../../packages/testkit/src/keys.ts';
import { mintToken } from '../../packages/testkit/src/tokens.ts';
import { privateNetwork } from '../harness/src/docker.ts';
import { startFloci } from '../harness/src/floci.docker.ts';
import { startFaultProxy } from '../harness/src/toxiproxy.docker.ts';
import { duplicateStatus } from '../suites/security.ts';

describe.skipIf(!process.env.E2E_DOCKER)('actual Floci Lambda HTTPS JWT verification', () => {
  // Two real Lambda containers start through Floci's REST/HTTP API integrations on a private network.
  it('verifies native REST/HTTP identities, alternate credentials, default CORS and real clocks', async () => {
    using directory = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-floci-'));
    const network = await privateNetwork();
    const tokens: string[] = [];
    let proxy: Awaited<ReturnType<typeof startFaultProxy>> | undefined;
    let app: Awaited<ReturnType<typeof startFloci>> | undefined;
    try {
      proxy = await startFaultProxy(tokens, network);
      const token = await mintToken({
        key: fixtureKey(2048),
        header: {},
        payload: {
          iss: proxy.issuer,
          aud: 'https://resource.example',
          sub: 'actual-floci-subject',
          exp: Math.floor(Date.now() / 1000) + 300,
        },
      });
      tokens.push(token);
      const now = Math.floor(Date.now() / 1000);
      const expired = await mintToken({
        key: fixtureKey(2048),
        header: {},
        payload: {
          iss: proxy.issuer,
          aud: 'https://resource.example',
          sub: 'expired-private-subject',
          exp: now - 3600,
        },
      });
      tokens.push(expired);
      app = await startFloci({
        directory: directory.path,
        issuer: proxy.issuer,
        caFile: proxy.caFile,
        network,
        tokens,
      });
      /**
       * Bounds every native request while asserting the complete public rejection and no handler
       * marker.
       */
      const fetch = (url: string, init?: RequestInit): Promise<Response> =>
        globalThis.fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
      /**
       * Fixed missing-token output distinguishes default guard execution from protected handlers.
       */
      const publicMissing = async (response: Response): Promise<void> => {
        expect(response.status).toBe(401);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(response.headers.get('content-type')).toBe('application/json');
        expect(response.headers.get('www-authenticate')).toBe('Bearer realm="api"');
        expect(response.headers.get('x-e2e-handler')).toBe(null);
        expect(await response.text()).toBe(
          '{"error":"missing_token","error_description":"A bearer token is required."}',
        );
      };
      for (const url of [app.restURL, app.httpURL]) {
        const missing = await fetch(url + '/protected');
        await publicMissing(missing);
        const response = await fetch(url + '/protected', {
          headers: { authorization: 'Bearer ' + token },
        });
        expect(response.status).toBe(200);
        expect(response.headers.get('x-e2e-handler')).toBe('verified');
        expect(await response.json()).toMatchObject({
          sub: 'actual-floci-subject',
          node: 'v24.22.2',
        });
        const query = await fetch(
          url + '/protected' + '?access_token=' + encodeURIComponent(token),
        );
        await publicMissing(query);
        await publicMissing(
          await fetch(url + '/protected', { headers: { cookie: 'access_token=' + token } }),
        );
        await publicMissing(
          await fetch(url + '/protected', {
            method: 'OPTIONS',
            headers: { origin: 'https://cors.example', 'access-control-request-method': 'GET' },
          }),
        );
        const expiredResponse = await fetch(url + '/protected', {
          headers: { authorization: 'Bearer ' + expired },
        });
        expect(expiredResponse.status).toBe(401);
        expect(expiredResponse.headers.get('cache-control')).toBe('no-store');
        expect(expiredResponse.headers.get('content-type')).toBe('application/json');
        expect(expiredResponse.headers.get('www-authenticate')).toBe(
          'Bearer error="invalid_token", error_description="The token has expired."',
        );
        expect(expiredResponse.headers.get('x-e2e-handler')).toBe(null);
        expect(await expiredResponse.text()).toBe(
          '{"error":"invalid_token","error_description":"The token has expired."}',
        );
        const preflight = await fetch(url + '/protected?e2e_cors=1', {
          method: 'OPTIONS',
          headers: { origin: 'https://cors.example', 'access-control-request-method': 'GET' },
        });
        expect(preflight.status).toBe(204);
        expect(preflight.headers.get('x-e2e-cors')).toBe('before-guard');
        expect(await preflight.text()).toBe('');
        const corsMissing = await fetch(url + '/protected?e2e_cors=1', {
          headers: { origin: 'https://cors.example' },
        });
        expect(corsMissing.status).toBe(401);
        expect(corsMissing.headers.get('cache-control')).toBe('no-store');
        expect(corsMissing.headers.get('access-control-allow-origin')).toBe('https://cors.example');
        await corsMissing.arrayBuffer();
        expect(await duplicateStatus(url + '/protected', [token, 'invalid'])).toBe(400);
        expect(await duplicateStatus(url + '/protected', ['invalid', token])).toBe(400);
      }

      app.verifyImages();
      expect(proxy.counts().requests).toBe(4);
    } finally {
      try {
        await app?.close();
      } finally {
        try {
          await proxy?.close();
        } finally {
          await network.stop();
        }
      }
    }
  }, 180_000);
});
