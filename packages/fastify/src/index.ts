import type { Auth, VerifiedClaims } from '@serverless-jwt/jwt-verifier';
import type { IntegrationOptions } from '@serverless-jwt/jwt-verifier/adapter';
import type {
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
  onRequestAsyncHookHandler,
} from 'fastify';

import { ConfigurationError, JwtVerifierError } from '@serverless-jwt/jwt-verifier';
import { authorizationFromNodeRequest, createGuard } from '@serverless-jwt/jwt-verifier/adapter';
import fp from 'fastify-plugin';

declare module 'fastify' {
  /**
   * The plugin exposes an opt-in hook on its registration scope.
   */
  interface FastifyInstance {
    /**
     * Authenticates only routes that explicitly install this hook unless global is true.
     */
    readonly authenticate: onRequestAsyncHookHandler;
  }
  /**
   * Global augmentation must represent every possible factory and route state.
   */
  interface FastifyRequest {
    /**
     * Per-request authentication, never shared between requests or plugin scopes.
     */
    readonly auth: Auth<unknown> | null | undefined;
  }
}

/**
 * Fastify hooks belong to the parent registration scope because fastify-plugin breaks
 * encapsulation.
 */
export type FastifyOptions<TIdentity = VerifiedClaims> = IntegrationOptions<TIdentity> & {
  /**
   * Protects every route in the registration scope; use an encapsulated child for a prefix.
   */
  readonly global?: boolean;
  /**
   * May finish the reply; undefined selects the default before commitment.
   */
  readonly onError?: (
    error: JwtVerifierError,
    request: FastifyRequest,
    reply: FastifyReply,
  ) => void | Promise<void>;
};

/**
 * Checks request state before narrowing the application's identity.
 */
export function getAuth<TIdentity = unknown>(request: FastifyRequest): Auth<TIdentity> {
  if (request.auth === null || request.auth === undefined) {
    throw new JwtVerifierError('auth_context_missing');
  }

  return request.auth as Auth<TIdentity>;
}

/**
 * Registers one verifier and an opt-in authenticate hook in the caller's scope.
 */
const plugin: FastifyPluginAsync<FastifyOptions<unknown>> = async (app, options): Promise<void> => {
  if (options.global !== undefined && typeof options.global !== 'boolean') {
    throw new ConfigurationError('invalid_guard_policy');
  }

  const guard = createGuard(options);
  const { onError } = options;
  if (!app.hasRequestDecorator('auth')) {
    app.decorateRequest('auth', undefined);
  }

  /**
   * Uses the original IncomingMessage rather than normalized Fastify headers.
   */
  const authenticate: onRequestAsyncHookHandler = async (request, reply): Promise<void> => {
    Object.assign(request, { auth: undefined });
    const controller = new AbortController();
    /**
     * Disconnect cancellation affects this invocation only, leaving shared key fetches available.
     */
    const abort = (): void => controller.abort();
    request.raw.once('aborted', abort);
    /**
     * Completed request bodies disconnect through the response rather than request abort events.
     */
    const close = (): void => {
      if (!reply.raw.writableFinished) {
        controller.abort();
      }
    };
    reply.raw.once('close', close);
    if (reply.raw.destroyed && !reply.raw.writableFinished) {
      controller.abort();
    }

    if (request.raw.readableAborted) {
      controller.abort();
    }

    const decision = await guard.decide(
      {
        method: request.method,
        url: request.url,
        authorization: authorizationFromNodeRequest(request.raw),
        header: (name: string): string | undefined => {
          const value = request.headers[name.toLowerCase()];
          return Array.isArray(value) ? value.join(', ') : value;
        },
      },
      controller.signal,
    );
    request.raw.removeListener('aborted', abort);
    reply.raw.removeListener('close', close);
    if (decision.kind === 'reject') {
      if (reply.raw.destroyed) {
        reply.hijack();
        return;
      }

      if (onError) {
        try {
          const result: unknown = await onError(decision.error, request, reply);
          if (result !== undefined) {
            throw new Error('Unusable custom response');
          }
        } catch (cause) {
          guard.reportErrorHookFailure();
          if (reply.sent || reply.raw.headersSent) {
            throw cause;
          }
        }
      }

      if (reply.raw.destroyed) {
        reply.hijack();
        return;
      }

      if (!reply.sent && !reply.raw.headersSent) {
        await reply
          .code(decision.http.status)
          .headers(decision.http.headers)
          .send(decision.http.body);
      } else {
        // A hook may commit streaming headers before finishing the response.
        reply.hijack();
      }

      return;
    }

    Object.assign(request, { auth: decision.kind === 'skip' ? undefined : decision.auth });
  };
  app.decorate('authenticate', authenticate);
  if (options.global === true) {
    app.addHook('onRequest', authenticate);
  }
};

/**
 * Fastify's official plugin wrapper exposes decorators without accidentally encapsulating them.
 */
export const serverlessJwt: FastifyPluginAsync<FastifyOptions<unknown>> = fp(plugin, {
  name: '@serverless-jwt/fastify',
  fastify: '5.x',
});
