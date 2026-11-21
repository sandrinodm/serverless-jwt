import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/solid-router';

/**
 * The actual framework root renders compiled RPC client code under normal Start defaults.
 */
export const Route = createRootRoute({
  component: () => (
    <html>
      <head>
        <HeadContent />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  ),
});
