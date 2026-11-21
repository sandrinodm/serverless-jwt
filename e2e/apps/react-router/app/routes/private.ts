import type { Route } from './+types/private.ts';

import { capabilityResponse, corsPreflight, corsResponse } from '../../capabilities.ts';
import { authContext, authentication } from '../auth.ts';

/**
 * Both resource loaders and actions receive the current request's verified identity.
 */
export const middleware: ReadonlyArray<Route.MiddlewareFunction> = [
  async ({ request }, next) => corsPreflight(request) ?? corsResponse(request, await next()),
  authentication,
];

/**
 * Context access preserves the application's actual identity type and explicit skip states.
 */
export function loader({ context, request }: Route.LoaderArgs): Response {
  const auth = context.get(authContext);
  if (!auth) {
    throw new Error('Protected route has no authenticated context');
  }

  if (process.env.E2E_LOG_CONTROL) {
    console.log(process.env.E2E_LOG_CONTROL);
  }

  return capabilityResponse(
    request,
    auth.identity.subject,
    Response.json({ subject: auth.identity.subject, method: request.method }),
  );
}

/**
 * Forged OPTIONS and mutations pass the same route middleware before reaching application code.
 */
export const action: typeof loader = loader;
