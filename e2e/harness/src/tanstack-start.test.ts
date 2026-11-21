import { mkdtempDisposableSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, inject, it } from 'vite-plus/test';

import { issuerTransport } from '../../../packages/testkit/src/issuer.ts';
import { fixtureKey } from '../../../packages/testkit/src/keys.ts';
import { mintToken } from '../../../packages/testkit/src/tokens.ts';
import { spawnTanStack } from '../../apps/tanstack-start/src/runtime.ts';

for (const framework of ['react', 'solid'] as const) {
  it(
    'authenticates real ' +
      framework +
      ' request middleware and compiled function RPC with isolated identities',
    async () => {
      using configuration = mkdtempDisposableSync(
        join(tmpdir(), 'serverless-jwt-start-' + framework + '-'),
      );
      const issuer = inject('e2eUrls').oidc;
      const transport = issuerTransport();
      const tokens: string[] = [];
      let app: Awaited<ReturnType<typeof spawnTanStack>> | undefined;
      try {
        const credentials = await Promise.all(
          Array.from({ length: 200 }, async (_, index): Promise<string> => {
            const response = await transport.fetch(issuer + '/token', {
              method: 'POST',
              headers: {
                authorization:
                  'Basic ' +
                  Buffer.from('client-' + index + ':synthetic-test-secret').toString('base64'),
                'content-type': 'application/x-www-form-urlencoded',
              },
              body: 'grant_type=client_credentials&scope=read%20write&resource=https%3A%2F%2Fresource.example',
            });
            expect(response.status).toBe(200);
            const token = ((await response.json()) as { readonly access_token: string })
              .access_token;
            tokens.push(token);
            return token;
          }),
        );
        app = await spawnTanStack(framework, issuer, tokens, configuration.path);
        const rpcInfo = await fetch(app.url + '/rpc-info');
        expect(rpcInfo.status).toBe(200);
        const addresses = (await rpcInfo.json()) as {
          readonly url: string;
          readonly serializedUrl: string;
        };
        const rpcPath = addresses.url;
        expect(rpcPath).toMatch(/^\/_serverFn\//u);
        for (const path of ['/api/me', rpcPath]) {
          const protocol = path === rpcPath ? { 'x-tsr-serverFn': 'true', origin: app.url } : {};
          const missing = await fetch(app.url + path, { headers: protocol });
          expect(missing.status).toBe(401);
          expect(missing.headers.get('cache-control')).toBe('no-store');
          expect(missing.headers.get('www-authenticate')).toBe('Bearer realm="api"');
          expect(missing.headers.get('content-type')).toBe('application/json');
          expect(await missing.text()).toBe(
            '{"error":"missing_token","error_description":"A bearer token is required."}',
          );
          for (let round = 0; round < 2; round++) {
            const values = await Promise.all(
              credentials.map(async (token) => {
                const response = await fetch(app?.url + path, {
                  headers: { ...protocol, authorization: 'Bearer ' + token },
                });
                expect(response.status).toBe(200);
                return response.json() as Promise<{
                  readonly subject: string;
                  readonly second: string;
                  readonly third: string;
                  readonly method: string;
                }>;
              }),
            );
            values.forEach((body, index) =>
              expect(body).toEqual({
                subject: 'client-' + index,
                second: 'client-' + index,
                third: 'client-' + index,
                method: 'GET',
              }),
            );
          }

          const comma = await fetch(app.url + path, {
            headers: {
              ...protocol,
              authorization: 'Bearer ' + credentials[0] + ', Bearer invalid',
            },
          });
          expect(comma.status).toBe(400);
          expect(comma.headers.get('cache-control')).toBe('no-store');
          expect(comma.headers.get('www-authenticate')).toBe('Bearer error="invalid_request"');
          expect(await comma.text()).toBe(
            '{"error":"invalid_request","error_description":"Multiple credentials are not allowed."}',
          );
          for (const values of [
            [credentials[0], 'invalid'],
            ['invalid', credentials[0]],
          ]) {
            const status = await new Promise<number>((resolve, reject) => {
              const request = httpRequest(
                app?.url + path,
                {
                  headers: { ...protocol, Authorization: values.map((value) => 'Bearer ' + value) },
                },
                (response) => {
                  response.resume();
                  response.once('end', () => resolve(response.statusCode ?? 0));
                },
              );
              request.once('error', reject);
              request.end();
            });
            expect(status).toBe(400);
          }
        }

        const serialized = await fetch(app.url + addresses.serializedUrl, {
          headers: {
            'x-tsr-serverFn': 'true',
            origin: app.url,
            authorization: 'Bearer ' + credentials[0],
            accept: 'application/json',
          },
        });
        expect(serialized.status).toBe(200);
        expect(serialized.headers.get('x-tss-serialized')).toBe('true');
        const serializedBody = await serialized.text();
        expect(() => JSON.parse(serializedBody)).not.toThrow();
        expect(serializedBody).toContain('client-0');
        expect(serializedBody).not.toContain(credentials[0]);
        expect(serializedBody).not.toContain('P4_PRIVATE_RPC_');
        expect(serializedBody).not.toContain('"auth"');

        const forged = await fetch(app.url + '/api/me', {
          method: 'OPTIONS',
          headers: { 'access-control-request-method': 'GET' },
        });
        expect(forged.status).toBe(401);
        const crossOrigin = await fetch(app.url + rpcPath, {
          headers: {
            'x-tsr-serverFn': 'true',
            origin: 'https://untrusted.example',
            authorization: 'Bearer ' + credentials[0],
          },
        });
        expect(crossOrigin.status).toBe(403);
        for (const method of ['POST', 'OPTIONS']) {
          const response = await fetch(app.url + '/api/me', {
            method,
            headers: { authorization: 'Bearer ' + credentials[0] },
          });
          expect(response.status).toBe(200);
          expect(await response.json()).toEqual({ subject: 'client-0', method });
        }

        const alias = await fetch(app.url + '/%61pi/me');
        expect(alias.status).toBe(401);
      } finally {
        try {
          await app?.close();
        } finally {
          await transport.close();
        }
      }
    },
    30_000,
  );

  it(
    'rejects invalid JWT and key outage through actual ' +
      framework +
      ' request and function pipelines',
    async () => {
      using configuration = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-start-hostile-'));
      const issuer = inject('e2eUrls').hostile;
      const key = fixtureKey(2048);
      const token = await mintToken({
        key,
        header: {},
        payload: {
          iss: issuer,
          aud: 'https://resource.example',
          sub: 'private-start',
          exp: Math.floor(Date.now() / 1000) + 300,
        },
      });
      const invalid = await mintToken({
        key,
        header: {},
        payload: {
          iss: issuer,
          aud: 'private-invalid-audience',
          exp: Math.floor(Date.now() / 1000) + 300,
        },
      });
      for (const outage of [false, true]) {
        const app = await spawnTanStack(
          framework,
          issuer,
          [token, invalid],
          configuration.path,
          issuer + (outage ? '/outage' : '/jwks'),
        );
        try {
          const info = await fetch(app.url + '/rpc-info');
          const rpcPath = ((await info.json()) as { readonly url: string }).url;
          for (const path of ['/api/me', rpcPath]) {
            const response = await fetch(app.url + path, {
              headers: {
                origin: app.url,
                'x-tsr-serverFn': 'true',
                authorization: 'Bearer ' + (outage ? token : invalid),
              },
            });
            expect(response.status).toBe(outage ? 503 : 401);
            expect(response.headers.get('retry-after')).toBe(outage ? '1' : null);
            expect(response.headers.get('cache-control')).toBe('no-store');
            expect(response.headers.get('content-type')).toBe('application/json');
            expect(response.headers.get('www-authenticate')).toBe(
              outage
                ? null
                : 'Bearer error="invalid_token", error_description="The token audience is invalid."',
            );
            expect(await response.text()).toBe(
              outage
                ? '{"error":"temporarily_unavailable","error_description":"Signing keys are unavailable."}'
                : '{"error":"invalid_token","error_description":"The token audience is invalid."}',
            );
          }
        } finally {
          await app.close();
        }
      }
    },
    15_000,
  );
}
