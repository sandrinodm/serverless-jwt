import { createFileRoute } from '@tanstack/react-router';

/**
 * Fixed public readiness performs no authentication work.
 */
export const Route = createFileRoute('/ready')({
  server: { handlers: { GET: () => new Response('ready') } },
});
