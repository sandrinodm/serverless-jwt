import type { ReactElement } from 'react';

import { Outlet } from 'react-router';

/**
 * The real Router document renders public content while resource APIs own bearer authentication.
 */
export default function App(): ReactElement {
  return (
    <html>
      <head />
      <body>
        <Outlet />
      </body>
    </html>
  );
}
