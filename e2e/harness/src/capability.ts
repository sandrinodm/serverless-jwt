import type { CapabilityRow } from '../../matrix.ts';

import { spawnAstro } from '../../apps/astro/src/runtime.ts';
import { spawnHono } from '../../apps/hono/src/runtime.ts';
import { spawnNetlify } from '../../apps/netlify/src/runtime.ts';
import { spawnNext } from '../../apps/next/src/runtime.ts';
import { spawnReactRouter } from '../../apps/react-router/app/runtime.ts';
import { spawnSvelteKit, spawnSvelteKitWorker } from '../../apps/sveltekit/src/runtime.ts';
import { spawnTanStack } from '../../apps/tanstack-start/src/runtime.ts';
import { spawnVercel } from '../../apps/vercel/src/runtime.ts';
import { cloudflareApp } from './cloudflare.ts';
import { spawnNitroHost } from './nitro-hosts.ts';
import { spawnNodeApplication } from './node.ts';
import { spawnExample } from './spawn.ts';

/**
 * Starts exactly the independently registered native host with either real OIDC or hostile HTTPS.
 */
export async function spawnCapability(
  row: CapabilityRow,
  issuer: string,
  tokens: ReadonlyArray<string>,
  configuration: string,
  jwksUri?: string,
): Promise<{ readonly url: string; readonly close: () => Promise<void> }> {
  let app: { readonly url: string; readonly close: () => Promise<void> } | undefined;
  switch (row.application ?? row.integration) {
    case 'express':
    case 'fastify':
    case 'aws-lambda':
    case 'netlify-v1':
    case 'next-pages':
    case 'nuxt':
    case 'nuxt-h3-v2':
      app = await spawnNodeApplication(
        row.application ?? row.integration,
        issuer,
        tokens,
        configuration,
        jwksUri,
      );
      break;
    case 'nitro':
    case 'solidstart':
      app = await spawnNitroHost(
        row.application as 'nitro' | 'solidstart',
        issuer,
        tokens,
        configuration,
        jwksUri,
      );
      break;
    case 'react-router':
      app = await spawnReactRouter(issuer, tokens, configuration, jwksUri);
      break;
    case 'tanstack-start':
      if (!row.framework) {
        throw new Error('Missing Start framework');
      }

      app = await spawnTanStack(row.framework, issuer, tokens, configuration, jwksUri);
      break;
    case 'astro':
      app = await spawnAstro(issuer, tokens, configuration, jwksUri);
      break;
    case 'reference-express':
      app = await spawnExample(issuer, tokens, jwksUri);
      break;
    case 'cloudflare':
      app = await cloudflareApp(
        row.host as 'workers' | 'pages',
        issuer,
        tokens,
        configuration,
        jwksUri,
      );
      break;
    case 'hono':
      app = await spawnHono(
        row.host as 'node' | 'bun' | 'deno' | 'workerd',
        issuer,
        tokens,
        configuration,
        jwksUri,
      );
      break;
    case 'next':
      app = await spawnNext(
        issuer,
        tokens,
        configuration,
        jwksUri,
        row.host === 'next-development',
      );
      break;
    case 'netlify':
      app = await spawnNetlify(issuer, tokens, configuration, jwksUri);
      break;
    case 'sveltekit':
      app = await (row.host === 'adapter-cloudflare' ? spawnSvelteKitWorker : spawnSvelteKit)(
        issuer,
        tokens,
        configuration,
        jwksUri,
      );
      break;
    case 'vercel':
      app = await spawnVercel(
        issuer,
        tokens,
        configuration,
        jwksUri,
        row.host === 'vercel-cli-development',
      );
      break;
    default:
      throw new Error('Matrix row has no real runtime driver');
  }

  return app;
}
