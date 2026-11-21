import type { APIContext } from 'astro';

/**
 * Native Web unit fields cover middleware-owned state; actual Astro builds/HTTP supply full
 * contexts.
 */
export function contextFixture(request: Request): APIContext {
  const context = {
    request,
    url: new URL(request.url),
    locals: {},
    params: {},
    isPrerendered: false,
  } satisfies Pick<APIContext, 'request' | 'url' | 'locals' | 'params' | 'isPrerendered'>;
  return context as APIContext;
}
