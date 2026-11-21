import { createFileRoute } from '@tanstack/react-router';

import { protectedRpc } from '../functions.ts';

/**
 * Real client consumption forces Start to compile and bundle the server-function stub.
 */
export const Route = createFileRoute('/rpc')({
  component: () => <button onClick={() => protectedRpc()}>RPC</button>,
});
