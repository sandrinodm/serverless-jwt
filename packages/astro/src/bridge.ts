import type { ViteUserConfig } from 'astro';

import type { RegisteredPolicy } from './protection.ts';

import { validatePatterns } from './protection.ts';

/**
 * Uses the real framework's public Vite plugin type without widening its interface.
 */
type JavaScriptPlugin<TPlugin> = TPlugin extends { readonly name: string }
  ? 'resolveId' extends keyof TPlugin
    ? TPlugin
    : never
  : never;

/**
 * Excludes native built-in plugin descriptors that intentionally expose no JavaScript hooks.
 */
type Plugin = JavaScriptPlugin<NonNullable<ViteUserConfig['plugins']>[number]>;

/**
 * Policy input for the private framework bridge.
 */
interface BridgeOptions {
  /**
   * Only an explicit predicate registration opts out of static pattern analysis.
   */
  readonly protect: ReadonlyArray<string> | 'predicate';
}

/**
 * Registers the immutable policy through supported Vite hooks, including packed SSR dependencies.
 */
export function policyPlugin(options: BridgeOptions): Plugin {
  const policy: RegisteredPolicy =
    options.protect === 'predicate'
      ? Object.freeze({ kind: 'predicate' })
      : Object.freeze({ kind: 'patterns', patterns: validatePatterns(options.protect) });
  const moduleId = '\0serverless-jwt-astro-policy';
  return {
    name: 'serverless-jwt-astro-policy',
    enforce: 'pre',
    config: () => ({ ssr: { noExternal: ['@serverless-jwt/astro'] } }),
    resolveId: (id: string): string | null =>
      id === '#serverless-jwt-astro-policy' ? moduleId : null,
    load: (id: string): string | null =>
      id === moduleId
        ? 'export const registeredPolicy = Object.freeze(' +
          JSON.stringify(policy).replace(/"patterns":(\[[^]*\])/u, '"patterns":Object.freeze($1)') +
          ');'
        : null,
  };
}
