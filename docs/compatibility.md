# Runtime and framework compatibility

The public packages support Node 24.0.0 and later. The verifier uses Web Crypto and Fetch. Its runtime checks also cover Deno, Bun and workerd. Each package guide lists its framework versions, entry points and host-specific limits.

| Package                                                | Integration boundary                                                       |
| ------------------------------------------------------ | -------------------------------------------------------------------------- |
| [JWT verifier](../packages/jwt-verifier/README.md)     | Portable verifier and bearer token extraction                              |
| [AWS Lambda](../packages/aws-lambda/README.md)         | API Gateway v1/v2 and ALB single-value or multi-value events               |
| [Cloudflare](../packages/cloudflare/README.md)         | Workers and Pages Functions on workerd                                     |
| [Netlify](../packages/netlify/README.md)               | Functions v2, Edge Functions and the deprecated Lambda-compatible v1 entry |
| [Vercel](../packages/vercel/README.md)                 | Named Web handlers                                                         |
| [Next.js](../packages/next/README.md)                  | App Router, proxy and Pages API routes                                     |
| [Hono](../packages/hono/README.md)                     | Node, Bun, Deno and workerd                                                |
| [Express](../packages/express/README.md)               | Express 5 middleware on Node                                               |
| [Fastify](../packages/fastify/README.md)               | Fastify 5 plugin on Node                                                   |
| [Astro](../packages/astro/README.md)                   | Native middleware and build integration                                    |
| [SvelteKit](../packages/sveltekit/README.md)           | Server hooks with adapter-node or adapter-cloudflare                       |
| [React Router](../packages/react-router/README.md)     | Server middleware and typed request context                                |
| [TanStack Start](../packages/tanstack-start/README.md) | React and Solid request and server-function middleware                     |
| [Nuxt and h3](../packages/nuxt/README.md)              | Nuxt/Nitro and h3 v1, with a separate h3 v2 entry                          |

## Host behavior

Duplicate Authorization detection depends on which headers reach the application. Node adapters with access to raw headers can inspect each field. Some framework servers and single-value events discard a field before the adapter runs. Each guide’s capability matrix lists the HTTP outcomes for both header orders. Check the same boundary behind your deployment’s proxy or gateway.

Static output can bypass server middleware. Follow the Astro and SvelteKit build-registration instructions when protecting routes that might be prerendered. Event-result APIs such as Lambda return the entire response at once. Cross-request key caching also depends on host lifetime and I/O isolation.

Strict TypeScript consumers of Astro 7.4.5 must run the [Astro declaration repair](astro-sdk-repair.md). The SolidStart test application uses a [workspace SDK patch](solidstart-sdk-repair.md).

The [development guide](development.md) describes how to run local host checks, strict tarball consumers and the nightly matrix. Hosted deployment and registry verification are part of the [release procedure](releasing.md).
