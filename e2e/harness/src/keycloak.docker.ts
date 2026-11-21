import './docker.ts';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { GenericContainer, Wait } from 'testcontainers';

import { issuerTransport } from '../../../packages/testkit/src/issuer.ts';
import { dockerLogs } from './docker-logs.ts';
import { dockerPort } from './docker-port.ts';
import { image } from './docker.ts';
import { dockerCertificates } from './tls.ts';

/**
 * Starts an imported real HTTPS realm with a SAN test-CA leaf and private, redacting log capture.
 */
export async function startKeycloak(): Promise<{
  readonly issuer: string;
  readonly tokens: string[];
  readonly grant: (client?: string) => Promise<string>;
  readonly rotate: () => Promise<void>;
  readonly close: () => Promise<void>;
}> {
  const certificates = dockerCertificates();
  const port = await dockerPort();
  const origin = 'https://localhost:' + port;
  const issuer = origin + '/realms/serverless-jwt';
  const transport = issuerTransport();
  const tokens: string[] = [];
  const logs = dockerLogs(tokens);
  mkdirSync(join(certificates.directory, 'import'));
  copyFileSync(
    new URL('../../keycloak/realm.json', import.meta.url),
    join(certificates.directory, 'import/realm.json'),
  );
  let container: Awaited<ReturnType<GenericContainer['start']>> | undefined;
  /**
   * Reaps the container even when the credential guard rejects captured output.
   */
  const close = async (): Promise<void> => {
    try {
      try {
        await container?.stop();
      } catch {
        throw new Error('Keycloak container stop failed');
      } finally {
        await logs.finish('reports/e2e/keycloak.log');
      }
    } finally {
      await transport.close();
      certificates.close();
    }
  };
  try {
    container = await new GenericContainer(image('keycloak'))
      .withExposedPorts({ container: 8443, host: port })
      .withBindMounts([
        { source: certificates.directory, target: '/tls', mode: 'ro' },
        {
          source: join(certificates.directory, 'import'),
          target: '/opt/keycloak/data/import',
          mode: 'ro',
        },
      ])
      .withEnvironment({
        KC_BOOTSTRAP_ADMIN_USERNAME: 'synthetic-admin',
        KC_BOOTSTRAP_ADMIN_PASSWORD: 'synthetic-admin-secret',
      })
      .withCommand([
        'start',
        '--http-enabled=false',
        '--https-certificate-file=/tls/server.crt',
        '--https-certificate-key-file=/tls/server-key.pem',
        '--truststore-paths=/tls/ca.crt',
        '--hostname=' + origin,
        '--import-realm',
      ])
      .withWaitStrategy(Wait.forLogMessage(/Listening on: https:/))
      .withLogConsumer((stream) => {
        logs.attach(stream);
      })
      .withStartupTimeout(90_000)
      .start();
    const discovery = await transport.fetch(issuer + '/.well-known/openid-configuration');
    assert.equal(discovery.status, 200);
    assert.equal(((await discovery.json()) as { readonly issuer: string }).issuer, issuer);
    /**
     * Obtains a real access token while registering it before any artifact leaves the buffer.
     */
    const grant = async (client = 'api-client'): Promise<string> => {
      const response = await transport.fetch(issuer + '/protocol/openid-connect/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: client,
          client_secret: 'synthetic-e2e-client-secret',
        }).toString(),
      });
      assert.equal(response.status, 200);
      const token = ((await response.json()) as { readonly access_token: string }).access_token;
      tokens.push(token);
      return token;
    };
    return {
      issuer,
      tokens,
      grant,
      close,
      async rotate(): Promise<void> {
        const response = await transport.fetch(
          origin + '/realms/master/protocol/openid-connect/token',
          {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'password',
              client_id: 'admin-cli',
              username: 'synthetic-admin',
              password: 'synthetic-admin-secret',
            }).toString(),
          },
        );
        assert.equal(response.status, 200);
        const token = ((await response.json()) as { readonly access_token: string }).access_token;
        tokens.push(token);
        const realmResponse = await transport.fetch(origin + '/admin/realms/serverless-jwt', {
          headers: { authorization: 'Bearer ' + token },
        });
        assert.equal(realmResponse.status, 200);
        const realm = (await realmResponse.json()) as { readonly id: string };
        const providersResponse = await transport.fetch(
          origin +
            '/admin/realms/serverless-jwt/components?' +
            new URLSearchParams({ parent: realm.id, type: 'org.keycloak.keys.KeyProvider' }),
          {
            headers: { authorization: 'Bearer ' + token },
          },
        );
        assert.equal(providersResponse.status, 200);
        const providers = (await providersResponse.json()) as ReadonlyArray<{
          readonly id: string;
          readonly providerId: string;
          readonly config: Readonly<Record<string, ReadonlyArray<string>>>;
        }>;
        const created = await transport.fetch(origin + '/admin/realms/serverless-jwt/components', {
          method: 'POST',
          headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'rotated-rsa',
            parentId: realm.id,
            providerId: 'rsa-generated',
            providerType: 'org.keycloak.keys.KeyProvider',
            config: {
              priority: ['200'],
              enabled: ['true'],
              active: ['true'],
              algorithm: ['RS256'],
              keySize: ['2048'],
            },
          }),
        });
        assert.equal(created.status, 201);
        await created.arrayBuffer();
        // Keep old RSA verification keys enabled but explicitly passive, matching real rotation.
        for (const provider of providers.filter(
          (candidate) => candidate.providerId === 'rsa-generated',
        )) {
          const passive = await transport.fetch(
            origin + '/admin/realms/serverless-jwt/components/' + provider.id,
            {
              method: 'PUT',
              headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
              body: JSON.stringify({
                ...provider,
                config: { ...provider.config, active: ['false'], enabled: ['true'] },
              }),
            },
          );
          assert.equal(passive.status, 204);
          await passive.arrayBuffer();
        }
      },
    };
  } catch {
    await close();
    throw new Error('Keycloak startup failed');
  }
}
