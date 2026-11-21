import { exportJWK, generateKeyPair } from 'jose';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import Provider from 'oidc-provider';

/**
 * Starts a real client-credentials authorization server over verified test-CA HTTPS.
 */
export async function startOidcIssuer(): Promise<{
  readonly url: string;
  readonly close: () => Promise<void>;
}> {
  const server = createServer({
    key: readFileSync(
      new URL('../../../packages/testkit/fixtures/server-key.pem', import.meta.url),
    ),
    cert: readFileSync(new URL('../../../packages/testkit/fixtures/server.crt', import.meta.url)),
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Issuer has no TCP address');
  }

  const url = `https://127.0.0.1:${address.port}`;
  try {
    const pair = await generateKeyPair('RS256', { extractable: true });
    const jwk = {
      ...(await exportJWK(pair.privateKey)),
      kid: 'oidc-provider',
      use: 'sig',
      alg: 'RS256',
    };
    const provider = new Provider(url, {
      clients: Array.from({ length: 200 }, (_, index) => ({
        client_id: `client-${index}`,
        client_secret: 'synthetic-test-secret',
        grant_types: ['client_credentials'],
        response_types: [],
        token_endpoint_auth_method: 'client_secret_basic',
      })),
      jwks: { keys: [jwk] },
      cookies: { keys: ['synthetic-test-cookie-key'] },
      features: {
        devInteractions: { enabled: false },
        clientCredentials: { enabled: true },
        resourceIndicators: {
          enabled: true,
          defaultResource: () => 'https://resource.example',
          getResourceServerInfo: () => ({
            scope: 'read write',
            audience: 'https://resource.example',
            accessTokenFormat: 'jwt',
            jwt: { sign: { alg: 'RS256' } },
          }),
        },
      },
    });
    server.on('request', provider.callback());
    return {
      url,
      close: async (): Promise<void> => {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      },
    };
  } catch (cause) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw cause;
  }
}
