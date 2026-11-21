import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';

import { privateLogs } from './logs.ts';

/**
 * Bounds each shutdown stage and clears its timer even when the process closes immediately.
 */
async function closesWithin(closed: Promise<void>, milliseconds: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      closed.then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reserves an available loopback port for an immediately spawned local framework CLI.
 */
export async function runtimePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Local runtime did not allocate a port');
  }

  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

/**
 * Starts an actual local framework process with isolated environment, bounded logs and readiness.
 */
export async function spawnRuntime(options: {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly url: string;
  readonly tokens: ReadonlyArray<string>;
  readonly readinessTimeout?: number;
  readonly logCapture?: 'buffer' | 'fingerprints';
}): Promise<{
  readonly url: string;
  readonly logFile: string;
  readonly close: () => Promise<void>;
}> {
  const child = spawn(options.command, [...options.args], {
    cwd: options.cwd,
    env: { NODE_ENV: 'test', ...options.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  const logs = privateLogs(options.tokens, options.logCapture);
  let exited = false;
  let spawnError: Error | undefined;
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
  child.once('exit', () => {
    exited = true;
  });
  child.once('error', (error) => {
    spawnError = error;
  });
  child.stdout.on('data', logs.capture);
  child.stderr.on('data', logs.capture);
  let closing: Promise<void> | undefined;
  /**
   * Stops only the owned process tree, bounds pipe shutdown and checks private logs on every path.
   */
  const close = (): Promise<void> => {
    closing ??= (async (): Promise<void> => {
      let shutdownFailed = false;
      /**
       * Signals the dedicated POSIX group or the Windows PID tree without selecting by name.
       */
      const signalTree = (signal: NodeJS.Signals): void => {
        if (!child.pid) {
          return;
        }

        try {
          if (process.platform === 'win32') {
            // Windows has no POSIX group signals; taskkill owns a bounded PID-tree operation.
            const result = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
              stdio: 'ignore',
              timeout: 1000,
              windowsHide: true,
            });
            shutdownFailed ||= Boolean(result.error) || (result.status !== 0 && !exited);
          } else {
            process.kill(-child.pid, signal);
          }
        } catch (cause) {
          shutdownFailed ||= (cause as NodeJS.ErrnoException).code !== 'ESRCH';
        }
      };
      signalTree('SIGTERM');
      await closesWithin(closed, 2000);
      // A descendant can close its pipes yet remain alive after its CLI exits.
      signalTree('SIGKILL');
      shutdownFailed ||= !(await closesWithin(closed, 1000));
      child.stdout.destroy();
      child.stderr.destroy();

      logs.finish('reports/e2e/runtime-' + child.pid + '.log');

      if (shutdownFailed) {
        throw new Error('Runtime teardown deadline exceeded or process tree could not be stopped');
      }
    })();
    return closing;
  };
  const deadline = Date.now() + (options.readinessTimeout ?? 10_000);
  try {
    while (Date.now() < deadline) {
      if (spawnError || exited) {
        throw new Error('Runtime exited before readiness');
      }

      try {
        const response = await fetch(options.url + '/ready', { signal: AbortSignal.timeout(200) });
        if (response.status === 200 && (await response.text()) === 'ready') {
          return { url: options.url, logFile: 'reports/e2e/runtime-' + child.pid + '.log', close };
        }
      } catch {
        // A local CLI needs a bounded startup window before opening its listener.
      }

      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }

    throw new Error('Runtime readiness deadline exceeded');
  } catch (cause) {
    await close();
    throw cause;
  }
}
