import { createRouter } from '@tanstack/react-router';

import { routeTree } from './routeTree.gen.ts';

/**
 * Native router serves the generated route tree with middleware attached to matched routes.
 */
export function getRouter(): ReturnType<typeof createRouter<typeof routeTree>> {
  return createRouter({ routeTree });
}
