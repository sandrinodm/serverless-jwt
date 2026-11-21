/**
 * Minimum native Request view shared by Web platforms without replacing their original objects.
 */
interface RequestView {
  /**
   * Original platform URL used only to select explicit fixture capabilities.
   */
  readonly url: string;

  /**
   * Actual native HTTP method; no request replacement occurs.
   */
  readonly method: string;

  /**
   * Read-only view of the original platform headers.
   */
  readonly headers: { readonly get: (name: string) => string | null };
}

/**
 * Test application CORS middleware runs before authentication only on explicitly opted-in URLs.
 */
export function corsPreflight(request: RequestView): Response | undefined {
  if (
    new URL(request.url).searchParams.get('e2e_cors') === '1' &&
    request.method === 'OPTIONS' &&
    (request.headers.get('origin') === 'https://cors.example' ||
      request.headers.get('origin') === new URL(request.url).origin) &&
    request.headers.get('access-control-request-method') === 'GET'
  ) {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': 'https://cors.example',
        'access-control-allow-methods': 'GET',
        'x-e2e-cors': 'before-guard',
      },
    });
  }

  return undefined;
}

/**
 * Application CORS headers also decorate complete authentication failures without exposing auth.
 */
export function corsResponse(request: RequestView, response: Response): Response {
  if (
    new URL(request.url).searchParams.get('e2e_cors') === '1' &&
    (request.headers.get('origin') === 'https://cors.example' ||
      request.headers.get('origin') === new URL(request.url).origin)
  ) {
    const headers = new Headers(response.headers);
    headers.set(
      'access-control-allow-origin',
      request.headers.get('origin') ?? 'https://cors.example',
    );
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  return response;
}

/**
 * A protected handler emits the first chunk now and the second a full second later. The guard must
 * finish before this function is called; rejected requests remain complete JSON.
 */
export function capabilityResponse(
  request: RequestView,
  subject: unknown,
  ordinary: Response,
): Response {
  if (new URL(request.url).searchParams.get('e2e_stream') !== '1') {
    return ordinary;
  }

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setTimeout> | undefined;
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(encoder.encode('verified:' + String(subject) + '\n'));
        timer = setTimeout(() => {
          controller.enqueue(encoder.encode('complete\n'));
          controller.close();
        }, 1000);
      },
      cancel(): void {
        clearTimeout(timer);
      },
    }),
    {
      headers: {
        'content-type': 'text/plain',
        'x-e2e-stream': 'verified',
        'cache-control': 'no-transform',
      },
    },
  );
}
