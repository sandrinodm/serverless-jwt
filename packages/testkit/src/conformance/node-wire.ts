import type { Server } from 'node:http';

import { connect } from 'node:net';

/**
 * Starts a real random-port Node listener and guarantees bounded test teardown.
 */
export async function listen(
  server: Server,
): Promise<{ readonly port: number; readonly [Symbol.asyncDispose]: () => Promise<void> }> {
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Missing test listener');
  }

  return {
    port: address.port,
    [Symbol.asyncDispose]: async (): Promise<void> => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

/**
 * Writes literal TCP header lines so Node cannot hide repeated authorization before ingress.
 */
export async function wireStatus(
  port: number,
  authorization: ReadonlyArray<string>,
  path = '/protected',
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port });
    let output = '';
    socket.setEncoding('utf8');
    socket.setTimeout(5_000, () => socket.destroy(new Error('Raw TCP test deadline')));
    socket.once('connect', () =>
      socket.write(
        `GET ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n${authorization.map((value) => `Authorization: ${value}\r\n`).join('')}\r\n`,
      ),
    );
    socket.on('data', (chunk: string) => {
      output += chunk;
    });
    socket.once('error', reject);
    socket.once('end', () => resolve(Number(/^HTTP\/1\.1 (\d+)/u.exec(output)?.[1] ?? 0)));
  });
}
