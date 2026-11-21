import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Application CORS runs before a native guard only on opted-in local fixture URLs.
 */
export function nodeCors(request: IncomingMessage, response: ServerResponse): boolean {
  const enabled =
    new URL(request.url ?? '/', 'http://localhost').searchParams.get('e2e_cors') === '1';
  if (enabled && request.headers.origin === 'https://cors.example') {
    response.setHeader('access-control-allow-origin', 'https://cors.example');
    if (
      request.method === 'OPTIONS' &&
      request.headers['access-control-request-method'] === 'GET'
    ) {
      response.setHeader('access-control-allow-methods', 'GET');
      response.setHeader('x-e2e-cors', 'before-guard');
      response.writeHead(204);
      response.end();
      return true;
    }
  }

  return false;
}

/**
 * Sends two real incremental chunks only after the application's native guard called its handler.
 */
export function nodeStream(
  request: IncomingMessage,
  response: ServerResponse,
  subject: unknown,
): boolean {
  if (new URL(request.url ?? '/', 'http://localhost').searchParams.get('e2e_stream') !== '1') {
    return false;
  }

  response.setHeader('content-type', 'text/plain');
  response.setHeader('x-e2e-stream', 'verified');
  response.write('verified:' + String(subject) + '\n');
  const timer = setTimeout(() => response.end('complete\n'), 1000);
  response.once('close', () => clearTimeout(timer));
  return true;
}
