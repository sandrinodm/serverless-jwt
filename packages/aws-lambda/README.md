# @serverless-jwt/aws-lambda

[README](../../README.md) · [Getting started](../../docs/getting-started.md) · [Configuration](../../docs/configuration.md) · [Errors](../../docs/errors.md) · [Compatibility](../../docs/compatibility.md)

Official promise-only handler wrappers for API Gateway REST (v1), HTTP API (v2), Lambda Function URLs (v2) and ALB. This is **not an API Gateway Lambda authorizer**: authorizers have a different response contract and caching. Response streaming with `awslambda.streamifyResponse` is unsupported in 1.0. Node 24+ is supported; `@types/aws-lambda` and Node types are optional peers used by TypeScript applications.

```ts
import { withJwt } from '@serverless-jwt/aws-lambda';
export const handler = withJwt.apiGatewayV2(
  {
    issuer: 'https://issuer.example',
    audience: 'https://api.example',
  },
  async (event, context, auth) => ({
    statusCode: 200,
    body: JSON.stringify({ subject: auth.claims.sub }),
  }),
);
```

Use `withJwt.apiGatewayV1` for REST events and `withJwt.alb` for ALB. The original event and context are passed unchanged, and auth occupies an explicit third argument. Downstream handlers must return a promise. Callbacks are never forwarded. Optional and skipped auth states are inferred.

ALB target groups must enable **multi-value headers** by default. Missing `multiValueHeaders` fails closed with fixed `adapter_misconfigured` (500). Explicit `albHeaders: 'single-value'` accepts single-value target groups, where **duplicate-credential detection is impossible** because ALB has already discarded earlier values. Default rejections use only `multiValueHeaders` in multi-value mode and only `headers` in single-value mode. API Gateway v1 uses authoritative multi-value headers; v2 rejects comma-joined credentials.

AWS's native invocation context has no AbortSignal. A caller that owns cancellation can supply `getSignal(event, context): AbortSignal | undefined`. It runs for each invocation using those original objects. Invalid results, async callbacks and thrown callbacks fail closed with fixed `adapter_misconfigured`; thenable failures are observed. Verification retains the existing default timeout when no signal is supplied.

`onError(error, event, context)` returns a matching result or undefined. Custom results are checked against their native ingress shape. API Gateway v1 requires a string body; v2 and ALB permit an omitted body, and v2 permits the native default status. Headers, cookies and encoding flags must be usable native values; ALB custom responses retain the selected header mode. Failures fall back to the safe ingress-specific response. AWS-source event fixtures are recorded under `packages/testkit/fixtures/aws/`.

Construct the factory once at module scope. Required authentication includes OPTIONS. Install framework CORS handling before authentication if it should answer genuine preflights. Optional mode supplies `null` for missing credentials; an explicit synchronous `skip` supplies `undefined`. Invalid credentials always reject. No claims or token contents enter default error responses. Default rejections are JSON and `cache-control: no-store`.

`onError` is awaited with the original platform arguments. Undefined selects the default before response commitment; failures report the fixed `integration.on_error_failed` diagnostic through `onIntegrationDiagnostic`, including when an existing verifier is supplied. Custom responses should retain `cache-control: no-store`. Application handler errors propagate through the framework's normal error path.

<!-- tested-environments:start -->

## Tested environments

| Area          | Environment or behavior                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| SDK types     | @types/aws-lambda 8.10.164                                                                                                                  |
| Forms         | API Gateway v1/v2, ALB single/multi-value; local Node 24 HTTP bridge                                                                        |
| Limits        | The ALB single-value boundary cannot recover discarded duplicate headers; hosted Lambda deployment unverified                               |
| Floci200 gate | Nightly check for 200 concurrent Lambda invocations on a dedicated GitHub-hosted runner. See the development guide for runner requirements. |

### Local capability matrix

Duplicate results list the HTTP status for two Authorization header orders, valid first and invalid first.

| Form / host                                           | Project | Route               | Duplicate results | Measured limits                                                                                                                                |
| ----------------------------------------------------- | ------- | ------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| aws-lambda-floci-v1 / floci-v1 (`.`)                  | nightly | `/protected`        | 400 / 400         | Event-result API: no incremental HTTP body.                                                                                                    |
| aws-lambda-floci-v2 / floci-v2 (`.`)                  | nightly | `/protected`        | 400 / 400         | Event-result API: no incremental HTTP body.                                                                                                    |
| aws-lambda-bridge-v1 / node24-bridge-v1 (`.`)         | pr      | `/protected/v1`     | 400 / 400         | Event-result API: no incremental HTTP body.                                                                                                    |
| aws-lambda-bridge-v2 / node24-bridge-v2 (`.`)         | pr      | `/protected/v2`     | 400 / 400         | Event-result API: no incremental HTTP body.                                                                                                    |
| aws-lambda-bridge-alb / node24-bridge-alb (`.`)       | pr      | `/protected/alb`    | 400 / 400         | Event-result API: no incremental HTTP body.                                                                                                    |
| aws-lambda-bridge-single / node24-bridge-single (`.`) | pr      | `/protected/single` | 401 / 200         | not enforceable here: explicitly selected ALB single-value headers retain only the last wire value Event-result API: no incremental HTTP body. |
| aws-lambda-sam-v1 / sam-v1 (`.`)                      | nightly | `/rest`             | 400 / 400         | Event-result API: no incremental HTTP body.                                                                                                    |
| aws-lambda-sam-v2 / sam-v2 (`.`)                      | nightly | `/http`             | 400 / 400         | Event-result API: no incremental HTTP body.                                                                                                    |

<!-- tested-environments:end -->
