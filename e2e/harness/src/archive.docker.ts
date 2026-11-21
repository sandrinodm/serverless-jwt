import './docker.ts';
import { GenericContainer, Wait } from 'testcontainers';

import { dockerLogs } from './docker-logs.ts';
import { dockerPort } from './docker-port.ts';
import { image } from './docker.ts';

/**
 * Exercises the actual Testcontainers archiver tar path after the transitive fixed-glob override.
 */
export async function archiveContainerProof(): Promise<string> {
  const logs = dockerLogs([]);
  let container: Awaited<ReturnType<GenericContainer['start']>> | undefined;
  /**
   * Always drains private output, including when daemon stop fails.
   */
  const close = async (): Promise<void> => {
    let stopFailed = false;
    try {
      await container?.stop();
    } catch {
      stopFailed = true;
    }

    await logs.finish('reports/e2e/archive.log');
    if (stopFailed) {
      throw new Error('Archive container stop failed');
    }
  };
  try {
    container = await new GenericContainer(image('toxiproxy'))
      .withExposedPorts({ container: 8474, host: await dockerPort() })
      .withWaitStrategy(Wait.forHttp('/version', 8474))
      .withCopyContentToContainer([
        { content: 'synthetic-archive-proof', target: '/tmp/proof.txt' },
      ])
      .withLogConsumer((stream) => {
        logs.attach(stream);
      })
      .start();
    const stream = await container.copyArchiveFromContainer('/tmp/proof.txt');
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }

    const archive = Buffer.concat(chunks);
    const size = Number.parseInt(
      archive.subarray(124, 136).toString().replaceAll('\0', '').trim(),
      8,
    );
    if (size !== Buffer.byteLength('synthetic-archive-proof')) {
      throw new Error('Actual container archive proof has an unexpected size');
    }

    return archive.subarray(512, 512 + size).toString();
  } catch {
    throw new Error('Archive container proof failed');
  } finally {
    await close();
  }
}
