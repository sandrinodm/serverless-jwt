# For integration authors

[README](../README.md) · [Development](development.md) · [Configuration](configuration.md) · [Errors](errors.md)

Official integrations import `@serverless-jwt/jwt-verifier/adapter`. Applications use their
framework package. Construct wrappers at module scope: `createGuard` constructs one verifier,
then reuses its isolated key cache. An existing verifier excludes all verifier configuration
at both the type and runtime boundaries. For missing credentials rejected before verification,
an existing verifier uses the guard default challenge realm `api`; its private realm is not
read or inherited. Configuration mode uses its explicit `realm`. Authentication policy (`mode`, `scopes`, `scopeMode`,
`skip`) still applies to that verifier.

This complete toy wrapper is fewer than 80 lines. It is an authoring example, not a generic
Fetch integration package:

```ts
import type { Auth } from '@serverless-jwt/jwt-verifier';
import type { IntegrationOptions } from '@serverless-jwt/jwt-verifier/adapter';

import {
  authorizationFromHeaders,
  createGuard,
  toResponse,
} from '@serverless-jwt/jwt-verifier/adapter';

export function toy<T>(
  options: IntegrationOptions<T>,
  handler: (request: Request, auth: Auth<T> | null | undefined) => Promise<Response>,
  onError?: () => Promise<Response | undefined>,
) {
  const guard = createGuard(options);
  return async (request: Request): Promise<Response> => {
    const decision = await guard.decide(
      {
        method: request.method,
        url: request.url,
        authorization: authorizationFromHeaders(request.headers),
        header: (name) => request.headers.get(name) ?? undefined,
      },
      request.signal,
    );
    if (decision.kind === 'reject') {
      if (onError) {
        try {
          const response = await onError();
          if (response !== undefined) {
            if (!(response instanceof Response) || response.bodyUsed || response.body?.locked) {
              throw new Error('Unusable custom response');
            }
            return response;
          }
        } catch {
          guard.reportErrorHookFailure();
        }
      }
      return toResponse(decision.http);
    }
    return handler(request, decision.kind === 'skip' ? undefined : decision.auth);
  };
}
```

Required mode gives the handler `Auth`; optional mode gives `Auth | null`. Explicitly skipped
requests and unguarded routes have `undefined`. Each public integration carries the mode
generic into its handler type. Global framework augmentation cannot vary per factory: use
`auth?: Auth<unknown> | null` and a checked `getAuth<T>` accessor that throws the fixed
`auth_context_missing` server error when a route was not guarded. Store no auth on shared
objects. Forward the original platform arguments unchanged.

No request, including CORS preflights, is skipped by default. Install framework CORS middleware
before the guard to answer real preflights. A `skip` predicate explicitly lets unauthenticated
requests reach the protected handler; inspect method and URL only when that is intentional.
It must synchronously return a boolean. Async or other nonboolean results fail closed with the
fixed `adapter_misconfigured` server error; returned thenables are observed without waiting.

Use the Node extractor's `headersDistinct`/`rawHeaders` inputs, never normalized Node headers.
API Gateway v1 uses authoritative `multiValueHeaders` when present. API Gateway v2 retains
comma joining. ALB requires multi-value mode by default; explicit single-value mode loses
duplicate detection and must report that capability gap. Every comma-joined value rejects.

Each integration owns its typed asynchronous `onError(error, platformArgs)`. Undefined uses
the default. Thrown, rejected or unusable results use the default only before response
commitment; after commitment, follow the platform's error path and never write another body.
Use `guard.reportErrorHookFailure()` for the fixed `integration.on_error_failed` event.
The **adapter-owned** `onIntegrationDiagnostic` observer works with either configuration or an
existing verifier. It does not inspect or replace that verifier's private observer or policy;
throws and rejected thenables are isolated. Custom responses should retain `cache-control:
no-store`. Default responses are JSON with fixed error text and no token data.

Register each public form in `packages/testkit/src/conformance/` using real platform types.
The suite enforces missing/malformed/invalid credentials, scopes, optional mode, abort,
handler error propagation, hook fallback, 200 concurrent identities and response headers.
Only transport duplicate preservation and streaming may skip, with a visible reason and
lost guarantee. The reference Fetch harness passes; four deliberately broken harnesses
prove the suite detects scope bypass, handler catching, auth leakage and comma acceptance.
Capability JSON is emitted to `reports/conformance/` and uploaded by CI.

Add a complete example under `e2e/apps/<integration>/` and run real HTTP contracts through
`e2e/harness/`. Issuers use verified test-CA HTTPS; never disable TLS verification. Spawned
servers have bounded readiness, teardown and private bounded log capture. Redact all minted
credentials and JWT-shaped text before reporting; logging any token fails the run.

Run both `pnpm test:peers <integration> min` and `max`. The runner uses disposable workspace
copies, overrides only in those copies, regenerates their lockfiles, verifies the actual
installed framework and runs types plus conformance. Maximum means newest stable release at
least seven days old. Document supported versions and host-specific limits in the package README. Finish with
`pnpm ready`, packing and `pnpm test:package` using exact tarballs.
