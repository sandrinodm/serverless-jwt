import type { RequestEvent } from '@sveltejs/kit';

/**
 * Native Web unit fixture supplies exactly the hook-owned SDK fields; real builds/HTTP test full
 * Kit events.
 */
export function eventFixture(request: Request): RequestEvent {
  const event = {
    request,
    url: new URL(request.url),
    locals: {},
    params: {},
    route: { id: '/api/me' },
    platform: undefined,
  } satisfies Pick<RequestEvent, 'request' | 'url' | 'locals' | 'params' | 'route' | 'platform'>;
  // RequestEvent has no constructor; unused cookies/tracing/fetch members belong to actual framework tests.
  return event as RequestEvent;
}
