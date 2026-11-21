import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';

/**
 * Loads the actual Vercel CLI function artifact and its declared handler path, never source.
 */
const output = resolve(import.meta.dirname, '../.vercel/output/functions/api/me.func');
/**
 * The real build output defines the executable entry and Node runtime.
 */
const config = JSON.parse(readFileSync(resolve(output, '.vc-config.json'), 'utf8'));
assert.equal(config.runtime, 'nodejs24.x');
/**
 * Actual named Web function built by Vercel.
 */
const handler = (await import(pathToFileURL(resolve(output, config.handler)).href)).GET;
assert.equal(typeof handler, 'function');

createServer(async (incoming, outgoing) => {
  if (incoming.url === '/ready') {
    outgoing.end('ready');
    return;
  }

  try {
    const headers = new Headers();
    for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
      headers.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1]);
    }

    const request = new Request('http://127.0.0.1' + incoming.url, {
      method: incoming.method,
      headers,
    });
    // This actual built-handler host intentionally calls the supported one-argument form.
    const response = await handler(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) {
      await pipeline(Readable.fromWeb(response.body), outgoing);
    } else {
      outgoing.end();
    }
  } catch {
    if (!outgoing.headersSent) {
      outgoing.writeHead(500);
      outgoing.end('server error');
    } else {
      outgoing.destroy();
    }
  }
}).listen(Number(process.env.PORT), '127.0.0.1');
