import type { Context } from '@netlify/functions';

/**
 * Complete SDK-shaped unit context; actual CLI contracts use the platform-owned context instead.
 */
export function contextFixture(): Context {
  const context = {
    account: { id: 'test-account' },
    cookies: {
      delete: () => {},
      get: () => '',
      set: () => {},
    },
    deploy: { context: 'dev', id: 'test-deploy', published: false },
    geo: {},
    ip: '127.0.0.1',
    json: (input: unknown): Response => Response.json(input),
    log: (): never => {
      throw new Error('Unexpected platform logging');
    },
    next: async (): Promise<Response> => new Response('downstream'),
    params: {},
    rewrite: async (): Promise<Response> => new Response('rewrite'),
    requestId: 'test-request',
    server: {},
    site: {},
    url: new URL('https://netlify.example/protected'),
    waitUntil: (): void => {},
  };
  return context;
}
