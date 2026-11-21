import type { RouteConfig } from '@react-router/dev/routes';

import { route } from '@react-router/dev/routes';

/**
 * Resource APIs attach authentication by matched route rather than raw pathname prefixes.
 */
const routes: RouteConfig = [
  route('api/me', 'routes/private.ts'),
  route('ready', 'routes/ready.ts'),
];

export default routes;
