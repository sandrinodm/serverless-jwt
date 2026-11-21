import { randomInt } from 'node:crypto';
import { createServer } from 'node:net';

/**
 * Selects a free low host port outside Linux's outbound ephemeral range for rootless Docker binds.
 */
export async function dockerPort(): Promise<number> {
  for (let attempt = 0; attempt < 64; attempt++) {
    const port = randomInt(18_000, 30_000);
    const server = createServer();
    const available = await new Promise<boolean>((resolve) => {
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => resolve(true));
    });
    if (available) {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      return port;
    }
  }

  throw new Error('No free non-ephemeral Docker host port was available');
}
