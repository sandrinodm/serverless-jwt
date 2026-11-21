import type { AdapterHarness, RequestSpec, ResponseSpec } from './types.ts';

import {
  authorizationFromHeaders,
  createGuard,
  toResponse,
} from '../../../jwt-verifier/src/adapter.ts';

/**
 * Reference integration on real Web requests and responses; never a published generic adapter.
 */
export const referenceHarness: AdapterHarness = {
  /**
   * Distinguishes the private Fetch reference entrypoint.
   */
  name: 'reference/fetch',

  /**
   * Constructs one guard before driving requests.
   */
  setup: async (options, handler) => {
    const guard = createGuard(options);
    /**
     * Runs the Web handler without buffering its response body.
     */
    const dispatch = async (spec: RequestSpec): Promise<Response> => {
      const request = new Request('https://resource.example/protected', {
        method: spec.method ?? 'GET',
        headers: spec.headers?.map(([name, value]) => [name, value]) ?? [],
        ...(spec.signal ? { signal: spec.signal } : {}),
      });
      const decision = await guard.decide(
        {
          method: request.method,
          url: request.url,
          authorization: authorizationFromHeaders(request.headers),
          header: (name) => request.headers.get(name) ?? undefined,
        },
        request.signal,
      );
      let response: Response | undefined;
      if (decision.kind === 'reject') {
        if (options.onError) {
          try {
            const custom = await options.onError(decision.error, { request });
            if (custom !== undefined) {
              if (!(custom instanceof Response) || custom.bodyUsed || custom.body?.locked) {
                throw new Error('Unusable response');
              }

              response = custom;
            }
          } catch {
            guard.reportErrorHookFailure();
          }
        }

        response ??= toResponse(decision.http);
      } else {
        response = await handler(decision.kind === 'skip' ? undefined : decision.auth, {
          env: 'test-env',
          ctx: 'test-ctx',
          params: 'test-params',
          context: 'test-context',
        });
      }

      return response;
    };
    /**
     * Normalizes output while optionally observing every chunk before the stream completes.
     */
    const send = async (
      spec: RequestSpec,
      onChunk?: (chunk: string) => void,
    ): Promise<ResponseSpec> => {
      const response = await dispatch(spec);
      let body = '';
      const decoder = new TextDecoder();
      if (response.body) {
        const reader = response.body.getReader();
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) {
              break;
            }

            const text = decoder.decode(chunk.value, { stream: true });
            body += text;
            onChunk?.(text);
          }

          body += decoder.decode();
        } finally {
          reader.releaseLock();
        }
      }

      return { status: response.status, headers: Object.fromEntries(response.headers), body };
    };
    return { send, stream: send, [Symbol.asyncDispose]: async (): Promise<void> => {} };
  },
};
