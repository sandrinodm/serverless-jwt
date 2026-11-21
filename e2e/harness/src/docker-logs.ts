import type { Readable } from 'node:stream';

import { spawn } from 'node:child_process';

import { privateLogs } from './logs.ts';

/**
 * Owns private Docker output until every attached transport reaches EOF, failing closed on loss.
 */
export function dockerLogs(
  tokens: ReadonlyArray<string>,
  mode: 'buffer' | 'fingerprints' = 'buffer',
  observe?: (chunk: Buffer) => void,
  timeout = 5_000,
): {
  readonly attach: (stream: Readable) => void;
  readonly seal: (path: string) => void;
  readonly finish: (path: string) => Promise<void>;
} {
  let logs = privateLogs(tokens, mode);
  let failed = false;
  let checkpoint: Buffer[] | undefined = mode === 'buffer' ? [] : undefined;
  let checkpointBytes = 0;
  let sealed = false;
  const streams: Array<{ readonly stream: Readable; readonly complete: Promise<void> }> = [];
  return {
    attach(stream): void {
      const complete = new Promise<void>((resolve) => {
        let ended = stream.readableEnded;
        stream.on('data', (chunk: Buffer) => {
          logs.capture(chunk);
          if (checkpoint && checkpointBytes + chunk.length <= 65_536) {
            checkpoint.push(Buffer.from(chunk));
            checkpointBytes += chunk.length;
          }

          observe?.(chunk);
        });
        stream.once('end', () => {
          ended = true;
          resolve();
        });
        stream.on('error', () => {
          failed = true;
          stream.destroy();
          resolve();
        });
        stream.once('close', () => {
          failed ||= !ended;
          resolve();
        });
        if (stream.destroyed || ended) {
          failed ||= !ended;
          resolve();
        }
      });
      streams.push({ stream, complete });
    },
    seal(path): void {
      if (sealed) {
        failed = true;
        throw new Error('Docker log checkpoint was already sealed');
      }

      sealed = true;
      // Replay the bounded startup prefix so credentials spanning this checkpoint remain visible.
      try {
        logs.finish(path);
        logs = privateLogs(tokens, 'fingerprints');
        for (const chunk of checkpoint ?? []) {
          logs.capture(chunk);
        }
      } catch (cause) {
        failed = true;
        throw cause;
      } finally {
        for (const chunk of checkpoint ?? []) {
          chunk.fill(0);
        }

        checkpoint = undefined;
        checkpointBytes = 0;
      }

      if (failed || !streams.length) {
        throw new Error('Docker log transport did not capture complete output');
      }
    },
    async finish(path): Promise<void> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.all(streams.map(({ complete }) => complete)),
          new Promise<void>((resolve) => {
            timer = setTimeout(() => {
              failed = true;
              for (const { stream } of streams) {
                stream.destroy();
              }

              resolve();
            }, timeout);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }

      let captureFailure: unknown;
      try {
        logs.finish(path);
      } catch (cause) {
        captureFailure = cause;
      }

      for (const chunk of checkpoint ?? []) {
        chunk.fill(0);
      }

      checkpoint = undefined;
      checkpointBytes = 0;
      if (failed || !streams.length) {
        throw new Error('Docker log transport did not capture complete output');
      }

      if (captureFailure) {
        throw captureFailure;
      }
    },
  };
}

/**
 * Runs one private subprocess with bounded output, EOF validation and an owned process group.
 */
export async function privateCommand(
  executable: string,
  args: ReadonlyArray<string>,
  timeout = 10_000,
  attach?: (stream: Readable) => void,
): Promise<string> {
  const child = spawn(executable, [...args], {
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    return await new Promise<string>((resolve, reject) => {
      let settled = false;
      let ended = 0;
      /**
       * Terminates only the process group created for this invocation, never the calling harness.
       */
      const kill = (): void => {
        try {
          if (child.pid && process.platform !== 'win32') {
            process.kill(-child.pid, 'SIGKILL');
          } else {
            child.kill('SIGKILL');
          }
        } catch {
          // An already-exited owned process has nothing left to terminate.
        }
      };
      /**
       * Reaps on every failure without retaining the subprocess's error or diagnostic contents.
       */
      const fail = (message: string): void => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          kill();
          child.stdout.destroy();
          child.stderr.destroy();
          reject(new Error(message));
        }
      };
      const timer = setTimeout(() => fail('Owned subprocess exceeded its deadline'), timeout);
      for (const stream of [child.stdout, child.stderr]) {
        stream.on('data', (chunk: Buffer) => {
          if (!attach) {
            bytes += chunk.length;
            if (bytes > 65_536) {
              fail('Owned subprocess exceeded its private output bound');
            } else if (stream === child.stdout) {
              chunks.push(Buffer.from(chunk));
            }
          }
        });
        stream.once('end', () => {
          ended++;
        });
        stream.on('error', () => fail('Owned subprocess output transport failed'));
        attach?.(stream);
      }

      child.once('error', () => fail('Owned subprocess failed'));
      child.once('close', (code) => {
        if (!settled) {
          if (code !== 0 || ended !== 2) {
            fail('Owned subprocess failed or did not capture complete output');
            return;
          }

          settled = true;
          clearTimeout(timer);
          kill();
          const joined = Buffer.concat(chunks);
          const output = joined.toString('utf8');
          joined.fill(0);
          resolve(output);
        }
      });
    });
  } finally {
    for (const chunk of chunks) {
      chunk.fill(0);
    }
  }
}

/**
 * Captures a complete owned Docker log snapshot with a bounded process-group lifetime and drain.
 */
export async function captureDockerLogs(
  id: string,
  attach: (stream: Readable) => void,
  timeout = 10_000,
): Promise<void> {
  await privateCommand('docker', ['logs', id], timeout, attach);
}
