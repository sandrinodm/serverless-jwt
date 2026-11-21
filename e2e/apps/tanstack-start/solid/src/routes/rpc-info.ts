import { createFileRoute } from '@tanstack/solid-router';

import { protectedRpc, serializedRpc } from '../functions.ts';

/**
 * The public compiler-generated RPC address is already present in the browser stub.
 */
export const Route = createFileRoute('/rpc-info')({
  server: {
    handlers: {
      GET: () => Response.json({ url: protectedRpc.url, serializedUrl: serializedRpc.url }),
    },
  },
});
