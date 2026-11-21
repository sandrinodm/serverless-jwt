import type { JSX } from 'solid-js';

import { Router } from '@solidjs/router';
import { FileRoutes } from '@solidjs/start/router';

/**
 * The ordinary SolidStart application shell participates in both native builds.
 */
export default function App(): JSX.Element {
  return (
    <Router>
      <FileRoutes />
    </Router>
  );
}
