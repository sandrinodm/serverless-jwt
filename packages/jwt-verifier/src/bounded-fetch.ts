import type { ResolvedOptions } from './options.ts';

import { emit } from './diagnostics.ts';
import { JwtVerifierError } from './errors.ts';
import { canShareInflight } from './runtime.ts';

/**
 * Fetches and parses bounded JSON under one header-and-body deadline, even for abort-ignoring
 * fetch.
 */
export async function boundedFetch(
  options: ResolvedOptions<unknown>,
  url: string,
  kind: 'jwks' | 'discovery',
): Promise<unknown> {
  const controller = new AbortController();
  const started = options.clock.now();
  const limit = kind === 'discovery' ? 65_536 : options.keys.maxResponseBytes;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const unavailable = new JwtVerifierError(
    kind === 'jwks' ? 'jwks_unavailable' : 'discovery_unavailable',
  );
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(unavailable);
    }, options.keys.timeout * 1000);
  });

  /**
   * Counts streamed bytes rather than trusting content-length or unbounded response.json.
   */
  const read = async (): Promise<unknown> => {
    const response = await options.fetch(url, {
      signal: controller.signal,
      redirect: canShareInflight() ? 'error' : 'manual',
      credentials: 'omit',
    });
    if (controller.signal.aborted) {
      void response.body?.cancel().catch(() => {});
      throw unavailable;
    }

    emit(options.onDiagnostic, {
      type: kind === 'jwks' ? 'jwks.fetch' : 'discovery.fetch',
      url,
      status: response.status,
      durationMs: options.clock.now() - started,
    });
    if (!response.ok || response.redirected) {
      void response.body?.cancel().catch(() => {});
      throw unavailable;
    }

    if (!response.body) {
      throw new JwtVerifierError(kind === 'jwks' ? 'jwks_invalid' : 'discovery_invalid');
    }

    const currentReader = response.body.getReader();
    reader = currentReader;
    try {
      let size = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        const result = await currentReader.read();
        if (controller.signal.aborted) {
          throw unavailable;
        }

        if (result.done) {
          break;
        }

        size += result.value.byteLength;
        if (size > limit) {
          throw new JwtVerifierError(kind === 'jwks' ? 'jwks_invalid' : 'discovery_invalid');
        }

        chunks.push(result.value);
      }

      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }

      try {
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
      } catch (cause) {
        throw new JwtVerifierError(kind === 'jwks' ? 'jwks_invalid' : 'discovery_invalid', {
          cause,
        });
      }
    } finally {
      void currentReader.cancel().catch(() => {});
      currentReader.releaseLock();
      reader = undefined;
    }
  };
  try {
    return await Promise.race([read(), timeout]);
  } catch (cause) {
    throw cause instanceof JwtVerifierError
      ? cause
      : new JwtVerifierError(kind === 'jwks' ? 'jwks_unavailable' : 'discovery_unavailable', {
          cause,
        });
  } finally {
    clearTimeout(timer);
    controller.abort();
    void reader?.cancel().catch(() => {});
  }
}
