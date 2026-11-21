import type { HarnessInstance, RequestSpec, ResponseSpec } from './types.ts';

/**
 * Observes actual platform responses without substituting requests or buffering streaming output.
 */
export function responseHarness(
  dispatch: (spec: RequestSpec) => Promise<Response>,
): HarnessInstance {
  /**
   * Retains exact response bytes while optionally observing chunks before producer completion.
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
}
