import './docker.ts';
import type { StartedNetwork } from 'testcontainers';

import { StartedToxiProxyContainer } from '@testcontainers/toxiproxy';
import { createServer } from 'node:https';
import { GenericContainer, Wait } from 'testcontainers';
import { TestContainers } from 'testcontainers';

import { fixtureKey } from '../../../packages/testkit/src/keys.ts';
import { dockerLogs } from './docker-logs.ts';
import { dockerPort } from './docker-port.ts';
import { image } from './docker.ts';
import { dockerCertificates } from './tls.ts';

/**
 * Routes both advertised discovery and JWKS over one real TCP fault proxy with verified HTTPS.
 */
export async function startFaultProxy(
  tokens: ReadonlyArray<string>,
  network?: StartedNetwork,
): Promise<{
  readonly issuer: string;
  readonly caFile: string;
  readonly sealLogs: () => void;
  readonly rotate: (kid: string) => void;
  readonly padding: (bytes: number) => void;
  readonly counts: () => { readonly requests: number; readonly connections: number };
  readonly toxic: (
    type: 'reset_peer' | 'latency' | 'timeout' | 'bandwidth' | 'slicer',
    attributes: Readonly<Record<string, number>>,
  ) => Promise<() => Promise<void>>;
  readonly close: () => Promise<void>;
}> {
  const certificates = dockerCertificates();
  let issuer = '';
  let padding = 0;
  let requests = 0;
  let connections = 0;
  let partial = '';
  let accountingOverflow = false;
  const logs = dockerLogs(tokens, 'buffer', (chunk) => {
    partial += chunk.toString();
    const lines = partial.split('\n');
    partial = lines.pop() ?? '';
    if (partial.length > 65_536) {
      accountingOverflow = true;
      partial = '';
    }

    for (const line of lines) {
      if (line.includes('Accepted client') && line.includes('jwt-faults')) {
        connections++;
      }
    }
  });
  const key = fixtureKey(2048);
  const keys = [key.jwk];
  const server = createServer(
    { cert: certificates.cert, key: certificates.key },
    (request, response) => {
      requests++;
      response.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
      response.end(
        JSON.stringify(
          request.url?.includes('.well-known')
            ? { issuer, jwks_uri: issuer + '/jwks', padding: 'x'.repeat(padding) }
            : { keys },
        ),
      );
    },
  );
  let container: Awaited<ReturnType<GenericContainer['start']>> | undefined;
  /**
   * Closes the daemon-owned proxy before its host HTTPS endpoint and leaf certificate directory.
   */
  const close = async (): Promise<void> => {
    try {
      try {
        await container?.stop();
      } catch {
        throw new Error('Proxy container stop failed');
      } finally {
        await logs.finish('reports/e2e/toxiproxy-' + container?.getId() + '.log');
      }

      if (accountingOverflow) {
        throw new Error('Proxy connection-accounting buffer limit exceeded');
      }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      certificates.close();
    }
  };
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('HTTPS upstream did not bind');
    }

    await TestContainers.exposeHostPorts(address.port);
    const configuration = new GenericContainer(image('toxiproxy'))
      .withExposedPorts(
        { container: 8474, host: await dockerPort() },
        { container: 8666, host: await dockerPort() },
      )
      .withWaitStrategy(Wait.forHttp('/version', 8474))
      .withCommand(['-host', '0.0.0.0', '-proxy-metrics'])
      .withLogConsumer(logs.attach);
    if (network) {
      configuration.withNetwork(network).withNetworkAliases('toxiproxy');
    }

    container = await configuration.start();
    const proxy = await new StartedToxiProxyContainer(container).createProxy({
      name: 'jwt-faults',
      upstream: 'host.testcontainers.internal:' + address.port,
      enabled: true,
    });
    issuer = network
      ? 'https://toxiproxy:' + proxy.instance.listen.split(':').at(-1)
      : 'https://localhost:' + proxy.port;
    return {
      issuer,
      sealLogs(): void {
        logs.seal('reports/e2e/toxiproxy-startup-' + container?.getId() + '.log');
      },
      rotate(kid): void {
        keys.push({ ...key.jwk, kid });
      },
      caFile: certificates.directory + '/ca.crt',
      padding(bytes): void {
        padding = bytes;
      },
      counts: (): { readonly requests: number; readonly connections: number } => ({
        requests,
        connections,
      }),
      async toxic(type, attributes): Promise<() => Promise<void>> {
        const toxic = await proxy.instance.addToxic({
          name: 'jwt-fault-' + type,
          type,
          stream: 'downstream',
          toxicity: 1,
          attributes: { ...attributes },
        });
        return async (): Promise<void> => {
          await toxic.remove();
        };
      },
      close,
    };
  } catch {
    await close();
    throw new Error('Proxy startup failed');
  }
}
