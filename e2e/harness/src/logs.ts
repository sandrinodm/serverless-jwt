import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Maximum bytes retained privately from one process, including split UTF-8 chunks.
 */
const MAX_LOG_BYTES = 65_536;

/**
 * Redacts complete credentials and compact JWT syntax before exposing server output.
 */
export function redactLogs(
  text: string,
  tokens: ReadonlyArray<string>,
): { readonly text: string; readonly leaked: boolean } {
  let leaked = false;
  /**
   * Replaces credentials with a stable, nonreversible correlation fingerprint.
   */
  const fingerprint = (token: string): string => {
    leaked = true;
    return '[token:' + createHash('sha256').update(token).digest('hex').slice(0, 12) + ']';
  };
  let output = text;
  for (const token of [...tokens].filter(Boolean).sort((a, b) => b.length - a.length)) {
    if (output.includes(token)) {
      output = output.replaceAll(token, fingerprint(token));
    }
  }

  output = output.replace(/[A-Za-z0-9_.-]+/g, (run) => {
    const segments = run.split('.');
    const offsets: number[] = [];
    let offset = 0;
    for (const segment of segments) {
      offsets.push(offset);
      offset += segment.length + 1;
    }

    const spans: Array<{ start: number; end: number }> = [];
    for (let index = 0; index + 2 < segments.length; index++) {
      if (!segments[index] || !segments[index + 1]) {
        continue;
      }

      try {
        const header = JSON.parse(
          Buffer.from(segments[index] ?? '', 'base64url').toString('utf8'),
        ) as unknown;
        if (header && typeof header === 'object' && !Array.isArray(header)) {
          const start = offsets[index] ?? 0;
          const end = (offsets[index + 2] ?? 0) + (segments[index + 2]?.length ?? 0);
          const previous = spans.at(-1);
          if (previous && previous.end >= start) {
            previous.end = end;
          } else {
            spans.push({ start, end });
          }
        }
      } catch {
        // Non-JSON base64 and Java package names are ordinary log content.
      }
    }

    let result = '';
    let consumed = 0;
    for (const span of spans) {
      result += run.slice(consumed, span.start) + fingerprint(run.slice(span.start, span.end));
      consumed = span.end;
    }

    return result + run.slice(consumed);
  });
  return { text: output, leaked };
}

/**
 * Owns bounded raw process bytes until final redaction, then erases them before artifact output.
 */
export function privateLogs(
  tokens: ReadonlyArray<string>,
  mode: 'buffer' | 'fingerprints' = 'buffer',
): {
  readonly capture: (chunk: Buffer | string) => void;
  readonly finish: (path: string) => void;
} {
  if (mode === 'fingerprints') {
    return fingerprintLogs(tokens);
  }

  let chunks: Buffer[] = [];
  let bytes = 0;
  let overflow = false;
  let finished = false;
  return {
    capture(chunk): void {
      if (finished) {
        return;
      }

      const buffer = Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk);
      if (bytes + buffer.length > MAX_LOG_BYTES) {
        // Keep the prefix intact so truncation cannot erase a previously leaked credential.
        overflow = true;
        buffer.fill(0);
        return;
      }

      chunks.push(buffer);
      bytes += buffer.length;
    },
    finish(path): void {
      if (finished) {
        return;
      }

      finished = true;
      const joined = Buffer.concat(chunks);
      const redacted = redactLogs(joined.toString('utf8'), tokens);
      joined.fill(0);
      for (const chunk of chunks) {
        chunk.fill(0);
      }

      chunks = [];
      bytes = 0;
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(
        path,
        overflow ? '[private log buffer exceeded; output discarded]\n' : redacted.text,
        { mode: 0o600 },
      );
      if (redacted.leaked || overflow) {
        throw new Error('Server log contains a credential or exceeds the private buffer');
      }
    },
  };
}

/**
 * Scans every byte with bounded JWT candidates and immutable-known-token KMP state, emitting only
 * hashes.
 */
function fingerprintLogs(tokens: ReadonlyArray<string>): {
  readonly capture: (chunk: Buffer | string) => void;
  readonly finish: (path: string) => void;
} {
  const registered = [...tokens];
  const matchers = registered.filter(Boolean).map((token) => {
    const pattern = Buffer.from(token);
    const prefix = new Uint32Array(pattern.length);
    for (let index = 1, matched = 0; index < pattern.length; index++) {
      while (matched > 0 && pattern[index] !== pattern[matched]) {
        matched = prefix[matched - 1] ?? 0;
      }

      if (pattern[index] === pattern[matched]) {
        matched++;
      }

      prefix[index] = matched;
    }

    return {
      pattern,
      prefix,
      position: 0,
      fingerprint: '[token:' + createHash('sha256').update(token).digest('hex').slice(0, 12) + ']',
    };
  });
  const digest = createHash('sha256');
  const fingerprints = new Set<string>();
  let bytes = 0;
  let tokenEvents = 0;
  let candidate = '';
  let overflow = false;
  let registryChanged = false;
  let finished = false;
  /**
   * Retains permanent failure state while bounding the fingerprint artifact independently of
   * volume.
   */
  const found = (fingerprint: string): void => {
    tokenEvents++;
    if (fingerprints.size < 256) {
      fingerprints.add(fingerprint);
    }
  };
  /**
   * Inspects a complete compact-token candidate; no candidate text ever leaves private memory.
   */
  const inspect = (): void => {
    const result = redactLogs(candidate, []);
    if (result.leaked) {
      for (const fingerprint of result.text.match(/\[token:[a-f0-9]{12}\]/g) ?? []) {
        found(fingerprint);
      }
    }

    candidate = '';
  };
  /**
   * Fails closed if later opaque registration could invalidate inspection of already processed
   * bytes.
   */
  const checkRegistry = (): void => {
    registryChanged ||=
      registered.length !== tokens.length ||
      registered.some((token, index) => token !== tokens[index]);
  };
  return {
    capture(chunk): void {
      if (finished) {
        return;
      }

      checkRegistry();
      const input = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      digest.update(input);
      bytes += input.length;
      for (const byte of input) {
        for (const matcher of matchers) {
          while (matcher.position > 0 && byte !== matcher.pattern[matcher.position]) {
            matcher.position = matcher.prefix[matcher.position - 1] ?? 0;
          }

          if (byte === matcher.pattern[matcher.position]) {
            matcher.position++;
          }

          if (matcher.position === matcher.pattern.length) {
            found(matcher.fingerprint);
            matcher.position = matcher.prefix[matcher.position - 1] ?? 0;
          }
        }

        if (
          (byte >= 65 && byte <= 90) ||
          (byte >= 97 && byte <= 122) ||
          (byte >= 48 && byte <= 57) ||
          byte === 45 ||
          byte === 95 ||
          byte === 46
        ) {
          if (candidate.length === MAX_LOG_BYTES) {
            overflow = true;
            candidate = '';
          }

          candidate += String.fromCharCode(byte);
        } else {
          inspect();
        }
      }
    },
    finish(path): void {
      if (finished) {
        return;
      }

      finished = true;
      checkRegistry();
      inspect();
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(
        path,
        JSON.stringify(
          {
            mode: 'fingerprints',
            bytes,
            sha256: digest.digest('hex'),
            tokenEvents,
            fingerprints: [...fingerprints],
            candidateOverflow: overflow,
            registryChanged,
          },
          null,
          2,
        ) + '\n',
        { mode: 0o600 },
      );
      for (const matcher of matchers) {
        matcher.pattern.fill(0);
        matcher.prefix.fill(0);
        matcher.position = 0;
      }

      candidate = '';
      if (tokenEvents || overflow || registryChanged) {
        throw new Error(
          'Server log contains a credential, exceeds the candidate bound, or changes its token registry',
        );
      }
    },
  };
}
