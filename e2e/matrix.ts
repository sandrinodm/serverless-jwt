/**
 * One separately asserted runtime route or preparation command for every public integration form.
 */
export interface CapabilityRow {
  /**
   * Unique independently checked runtime/form identifier.
   */
  readonly id: string;

  /**
   * Public integration package or private reference example.
   */
  readonly integration: string;

  /**
   * Separately installed app when one package has several native examples.
   */
  readonly application?: string;

  /**
   * Echo field preserved by the real framework's handler.
   */
  readonly subjectField?: 'sub' | 'subject';

  /**
   * Native server function endpoints require their actual protocol headers.
   */
  readonly rpc?: boolean;

  /**
   * Native dispatch can reject a method before the authentication middleware is called.
   */
  readonly preflightStatus?: 405;

  /**
   * Explains a native method-dispatch boundary instead of claiming guard enforcement there.
   */
  readonly preflightReason?: string;

  /**
   * Which independently built Start framework owns this route.
   */
  readonly framework?: 'react' | 'solid';

  /**
   * Exact package export exercised by the named route.
   */
  readonly entrypoint: string;

  /**
   * Actual framework or native runtime serving this form.
   */
  readonly host: string;

  /**
   * Least-privileged project assigned to execute this row.
   */
  readonly project: 'pr' | 'nightly';

  /**
   * Source test module required to complete the row.
   */
  readonly file: string;

  /**
   * Actual protected network route, or explicit build-only behavior.
   */
  readonly route: string;

  /**
   * Expected statuses for both raw header orders, or null for explicit non-HTTP preparation.
   */
  readonly duplicates: readonly [number, number] | null;

  /**
   * Event-result APIs cannot deliver an incremental body; build forms have no HTTP response.
   */
  readonly streaming?: 'event-result' | 'build-only' | 'preparation-only';

  /**
   * Native server functions dispatch only GET; other forms test GET, POST and OPTIONS.
   */
  readonly methods?: ReadonlyArray<'GET'>;

  /**
   * Explicit lost guarantee or non-HTTP applicability explanation.
   */
  readonly duplicateReason?: string;

  /**
   * Native development workers may be request-scoped; this forbids a warm-cache claim.
   */
  readonly cacheReason?: string;
}

/**
 * Both full-concurrency Floci rows run in this dedicated native test file.
 */
export const flociIsolationFile = 'e2e/platforms/floci-isolation.docker.e2e.ts';

/**
 * Independent ingress expectations; runtime observations never update this table automatically.
 */
export const capabilityMatrix: ReadonlyArray<CapabilityRow> = [
  ...(['nitro', 'solidstart'] as const).map((application): CapabilityRow => ({
    id: 'nuxt-' + application,
    integration: 'nuxt',
    application,
    entrypoint: application === 'nitro' ? '.' : './h3-v2',
    host: application === 'nitro' ? 'nitro-node' : 'solidstart-nitro-node',
    project: 'nightly',
    file: 'e2e/harness/src/security.test.ts',
    route: '/protected',
    duplicates: [400, 400],
  })),
  ...(['v1', 'v2'] as const).map((shape): CapabilityRow => ({
    id: 'aws-lambda-floci-' + shape,
    integration: 'aws-lambda',
    entrypoint: '.',
    host: 'floci-' + shape,
    project: 'nightly',
    file: flociIsolationFile,
    route: '/protected',
    streaming: 'event-result',
    duplicates: [400, 400],
  })),
  ...(['route', 'proxy'] as const).map((form): CapabilityRow => ({
    id: 'next-dev-' + form,
    integration: 'next',
    entrypoint: '.',
    host: 'next-development',
    project: 'nightly',
    file: 'e2e/harness/src/security.test.ts',
    route: form === 'route' ? '/direct/me/development' : '/api/me/development',
    duplicates: [200, 401],
    duplicateReason:
      'not enforceable here: native Next Node ingress retains only the first Authorization wire line',
  })),
  {
    id: 'vercel-dev',
    cacheReason:
      'not enforceable here: native Vercel dev forks and discards one function worker per request; both 200-request rounds have cold verifier caches, while production Node24 separately proves persistent warm-cache behavior',
    integration: 'vercel',
    entrypoint: '.',
    host: 'vercel-cli-development',
    project: 'nightly',
    file: 'e2e/harness/src/security.test.ts',
    route: '/api/me',
    duplicates: [200, 401],
    duplicateReason:
      'not enforceable here: native Vercel development ingress retains only the first Authorization wire line',
  },
  {
    id: 'sveltekit-worker',
    integration: 'sveltekit',
    entrypoint: '.',
    host: 'adapter-cloudflare',
    project: 'nightly',
    file: 'e2e/harness/src/security.test.ts',
    route: '/api/me',
    duplicates: [400, 400],
  },

  ...(['express', 'fastify'] as const).map((integration): CapabilityRow => ({
    id: integration + '-node',
    integration,
    entrypoint: '.',
    host: 'node24',
    project: 'pr',
    file: 'e2e/harness/src/security.test.ts',
    route: '/protected',
    duplicates: [400, 400],
  })),
  ...(['v1', 'v2', 'alb', 'single'] as const).map((shape): CapabilityRow => ({
    id: 'aws-lambda-bridge-' + shape,
    streaming: 'event-result',
    integration: 'aws-lambda',
    entrypoint: '.',
    host: 'node24-bridge-' + shape,
    project: 'pr',
    file: 'e2e/harness/src/security.test.ts',
    route: '/protected/' + shape,
    duplicates: shape === 'single' ? [401, 200] : [400, 400],
    ...(shape === 'single'
      ? {
          duplicateReason:
            'not enforceable here: explicitly selected ALB single-value headers retain only the last wire value',
        }
      : {}),
  })),
  {
    id: 'next-pages',
    integration: 'next',
    application: 'next-pages',
    entrypoint: './pages',
    host: 'next-pages-production',
    project: 'pr',
    file: 'e2e/harness/src/security.test.ts',
    route: '/api/protected',
    duplicates: [400, 400],
  },
  {
    id: 'netlify-v1',
    streaming: 'event-result',
    integration: 'netlify',
    application: 'netlify-v1',
    entrypoint: './v1',
    host: 'node24-recorded-event',
    project: 'pr',
    file: 'e2e/harness/src/security.test.ts',
    route: '/protected',
    duplicates: [400, 400],
  },
  ...(['nuxt', 'nuxt-h3-v2'] as const).map((application): CapabilityRow => ({
    id: application,
    integration: 'nuxt',
    application,
    entrypoint: application === 'nuxt' ? '.' : './h3-v2',
    host: application === 'nuxt' ? 'nuxt-nitro-node' : 'h3-v2-node',
    project: 'pr',
    file: 'e2e/harness/src/security.test.ts',
    route: '/protected',
    duplicates: [400, 400],
  })),
  {
    id: 'react-router',
    integration: 'react-router',
    entrypoint: '.',
    host: 'react-router-serve',
    subjectField: 'subject',
    project: 'pr',
    file: 'e2e/harness/src/security.test.ts',
    route: '/api/me',
    duplicates: [200, 401],
    duplicateReason:
      'not enforceable here: standalone react-router-serve drops later Authorization lines before Request construction',
  },
  ...(['react', 'solid'] as const).flatMap((framework): ReadonlyArray<CapabilityRow> =>
    [false, true].map((rpc): CapabilityRow => ({
      id: 'tanstack-start-' + framework + (rpc ? '-function' : '-request'),
      integration: 'tanstack-start',
      entrypoint: '.',
      framework,
      rpc,
      ...(rpc ? { methods: ['GET'] as const } : {}),
      ...(rpc
        ? {
            preflightStatus: 405 as const,
            preflightReason:
              'Native GET-only server function rejects OPTIONS before function middleware and handler dispatch; request middleware still requires authentication for OPTIONS.',
          }
        : {}),
      subjectField: 'subject',
      host: framework + '-nitro-node',
      project: 'pr',
      file: 'e2e/harness/src/security.test.ts',
      route: rpc ? 'runtime-discovered-function' : '/api/me',
      duplicates: [400, 400],
    })),
  ),
  ...(['v1', 'v2'] as const).map((shape): CapabilityRow => ({
    id: 'aws-lambda-sam-' + shape,
    streaming: 'event-result',
    integration: 'aws-lambda',
    entrypoint: '.',
    host: 'sam-' + shape,
    project: 'nightly',
    file: 'e2e/platforms/sam.docker.e2e.ts',
    route: shape === 'v1' ? '/rest' : '/http',
    duplicates: [400, 400],
  })),
  {
    id: 'astro-node',
    integration: 'astro',
    entrypoint: '.',
    host: 'astro-node-standalone',
    project: 'pr',
    file: 'e2e/harness/src/security.test.ts',
    route: '/api/me',
    duplicates: [200, 401],
    duplicateReason:
      'not enforceable here: standalone Astro ingress drops later raw Authorization lines before middleware receives Request',
  },
  {
    id: 'astro-type-repair',
    streaming: 'preparation-only',
    integration: 'astro',
    entrypoint: './type-repair',
    host: 'node-declaration-preparation',
    project: 'pr',
    file: 'e2e/harness/src/security.test.ts',
    route: 'read-only declaration preparation check',
    duplicates: null,
    duplicateReason:
      'not enforceable here: declaration preparation has no HTTP ingress or response; runtime authentication is covered by astro-node',
  },
  {
    id: 'astro-build',
    streaming: 'build-only',
    integration: 'astro',
    entrypoint: './build',
    host: 'astro-build-policy',
    project: 'pr',
    file: 'e2e/harness/src/security.test.ts',
    route: 'build-time policy',
    duplicates: [400, 400],
    duplicateReason:
      'build-only entry point: no HTTP ingress; runtime behavior is covered by astro-node',
  },
  {
    id: 'reference-express',
    integration: 'reference-express',
    entrypoint: '.',
    host: 'node',
    project: 'pr',
    file: 'e2e/harness/src/security.test.ts',
    route: '/protected',
    duplicates: [400, 400],
  },
  {
    id: 'cloudflare-workers',
    integration: 'cloudflare',
    entrypoint: '.',
    host: 'workers',
    project: 'pr',
    file: 'e2e/harness/src/security.test.ts',
    route: '/protected',
    duplicates: [400, 400],
  },
  {
    id: 'cloudflare-pages',
    integration: 'cloudflare',
    entrypoint: '.',
    host: 'pages',
    project: 'pr',
    file: 'e2e/harness/src/security.test.ts',
    route: '/api/me',
    duplicates: [400, 400],
  },
  ...(['node', 'bun', 'deno', 'workerd'] as const).map((host): CapabilityRow => ({
    id: 'hono-' + host,
    integration: 'hono',
    entrypoint: '.',
    host,
    project: 'pr',
    file: 'e2e/harness/src/security.test.ts',
    route: '/api/me',
    duplicates: [400, 400],
  })),
  {
    id: 'next-route',
    integration: 'next',
    entrypoint: '.',
    host: 'next-production-route',
    project: 'pr',
    file: 'e2e/harness/src/security.test.ts',
    route: '/direct/me/original',
    duplicates: [200, 401],
    duplicateReason:
      'not enforceable here: Next Node ingress discards later raw Authorization lines before NextRequest exists',
  },
  {
    id: 'next-proxy',
    integration: 'next',
    entrypoint: '.',
    host: 'next-production-proxy',
    project: 'pr',
    file: 'e2e/harness/src/security.test.ts',
    route: '/api/me/original',
    duplicates: [200, 401],
    duplicateReason:
      'not enforceable here: Next Node ingress discards later raw Authorization lines before NextRequest exists',
  },
  {
    id: 'netlify-v2',
    integration: 'netlify',
    entrypoint: '.',
    host: 'netlify-offline',
    project: 'pr',
    file: 'e2e/harness/src/security.test.ts',
    route: '/.netlify/functions/me',
    duplicates: [200, 401],
    duplicateReason:
      'not enforceable here: Netlify Functions local ingress discards later Authorization lines',
  },
  {
    id: 'netlify-edge',
    integration: 'netlify',
    entrypoint: './edge',
    host: 'netlify-deno-edge',
    project: 'pr',
    file: 'e2e/harness/src/security.test.ts',
    route: '/edge/me',
    duplicates: [200, 401],
    duplicateReason:
      'not enforceable here: Netlify local proxy discards later raw Authorization lines before Deno Edge receives the Request',
  },
  {
    id: 'vercel-output',
    integration: 'vercel',
    entrypoint: '.',
    host: 'vercel-output-node24',
    project: 'pr',
    file: 'e2e/harness/src/security.test.ts',
    route: '/api/me',
    duplicates: [400, 400],
  },
  {
    id: 'sveltekit-node',
    integration: 'sveltekit',
    entrypoint: '.',
    host: 'adapter-node',
    project: 'pr',
    file: 'e2e/harness/src/security.test.ts',
    route: '/api/me',
    duplicates: [200, 401],
    duplicateReason:
      'not enforceable here: adapter-node constructs Request from Node headers after later Authorization values are discarded',
  },
  {
    id: 'sveltekit-build',
    streaming: 'build-only',
    integration: 'sveltekit',
    entrypoint: './build',
    host: 'vite-build-policy',
    project: 'pr',
    file: 'e2e/harness/src/security.test.ts',
    route: 'build-time policy',
    duplicates: [400, 400],
    duplicateReason:
      'build-only entry point: no HTTP ingress; runtime rejection is covered by sveltekit-node',
  },
];
