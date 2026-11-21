import type { ServerResponse } from 'node:http';

import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
/**
 * Adapts Web-stream chunks to Node's pipeline without conflating their declaration packages.
 */
async function* bodyChunks(body: NonNullable<Response['body']>): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) {
        return;
      }

      yield result.value;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Pipes platform output incrementally while preserving backpressure and stream failure handling.
 */
export async function writeResponse(output: Response, response: ServerResponse): Promise<void> {
  response.writeHead(output.status, Object.fromEntries(output.headers));
  if (!output.body) {
    response.end();
    return;
  }

  await pipeline(Readable.from(bodyChunks(output.body)), response);
}
