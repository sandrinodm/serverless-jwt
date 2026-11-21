import { createCsrfMiddleware, createMiddleware, createStart } from '@tanstack/solid-start';

import { corsPreflight, corsResponse } from '../../capabilities.ts';

/**
 * Native global application CORS precedes request and function authentication without client state.
 */
const cors = createMiddleware({ type: 'request' }).server(async ({ request, next }) => {
  const preflight = corsPreflight(request);
  if (preflight) {
    return preflight;
  }

  const result = await next();
  return { ...result, response: corsResponse(request, result.response) };
});

/**
 * The framework compiler loads this native entry before dispatching resource or RPC middleware.
 */
export const startInstance = createStart(() => ({
  requestMiddleware: [
    cors,
    createCsrfMiddleware({ filter: (context) => context.handlerType === 'serverFn' }),
  ],
}));
