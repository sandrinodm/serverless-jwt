import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, writeFileSync } from 'node:fs';

/**
 * Keeps child output private and bounded until both pipes close, then writes redacted evidence.
 */
export function capturePrivateOutput(child, path, tokens = []) {
  const limit = 65536;
  const chunks = { stdout: [], stderr: [] };
  let size = 0;
  let overflow = false;
  let spawnFailed = false;
  const closed = new Promise((resolve) => child.once('close', resolve));
  child.on('error', () => {
    spawnFailed = true;
  });
  for (const name of ['stdout', 'stderr']) {
    child[name].on('data', (chunk) => {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > limit) {
        overflow = true;
        chunks.stdout.length = 0;
        chunks.stderr.length = 0;
        return;
      }

      chunks[name].push(bytes);
    });
  }

  let finishing;
  /**
   * Stops the owned group even when its launcher exits first; never exposes child error objects.
   */
  const finish = () => {
    finishing ??= (async () => {
      let shutdownFailed = false;
      /**
       * Signals only the dedicated POSIX group or the Windows process tree.
       */
      const signal = (value) => {
        if (!child.pid) {
          return;
        }

        try {
          if (process.platform === 'win32') {
            const result = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
              stdio: 'ignore',
              timeout: 1000,
              windowsHide: true,
            });
            shutdownFailed ||=
              Boolean(result.error) ||
              (result.status !== 0 && child.exitCode === null && child.signalCode === null);
          } else {
            process.kill(-child.pid, value);
          }
        } catch (cause) {
          shutdownFailed ||= cause.code !== 'ESRCH';
        }
      };
      /**
       * Bounds shutdown even when a descendant keeps a pipe open.
       */
      const within = async (milliseconds) => {
        let timer;
        try {
          return await Promise.race([
            closed.then(() => true),
            new Promise((resolve) => {
              timer = setTimeout(() => resolve(false), milliseconds);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      };
      signal('SIGTERM');
      await within(2000);
      signal('SIGKILL');
      shutdownFailed ||= !(await within(1000));
      child.stdout.destroy();
      child.stderr.destroy();
      let leaked = false;
      /**
       * Records a stable fingerprint instead of credential contents.
       */
      const redact = (token) => {
        leaked = true;
        return `[token:${createHash('sha256').update(token).digest('hex').slice(0, 12)}]`;
      };
      const text = overflow
        ? '[private output exceeded 65536 bytes; evidence rejected]\n'
        : ['stdout', 'stderr']
            .map((name) => {
              let raw = Buffer.concat(chunks[name]).toString('utf8');
              for (const token of tokens) {
                if (token && raw.includes(token)) {
                  raw = raw.replaceAll(token, redact(token));
                }
              }

              return raw.replace(/[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g, redact);
            })
            .join('');
      chunks.stdout.length = 0;
      chunks.stderr.length = 0;
      writeFileSync(path, text, { mode: 0o600 });
      chmodSync(path, 0o600);
      if (overflow || leaked) {
        throw new Error('Child log contains a credential or exceeds the private buffer');
      }

      if (spawnFailed) {
        throw new Error('Child process could not start');
      }

      if (shutdownFailed) {
        throw new Error('Child process tree could not be stopped');
      }
    })();
    return finishing;
  };
  return { closed, finish };
}

/**
 * Runs install/build children with the same private evidence and bounded teardown as servers.
 */
export async function runPrivateCommand(command, args, options, path, tokens = []) {
  const child = spawn(command, args, {
    ...options,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  const capture = capturePrivateOutput(child, path, tokens);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void capture.finish().catch(() => {});
  }, 240_000);
  try {
    await capture.closed;
  } finally {
    clearTimeout(timer);
    await capture.finish();
  }

  if (timedOut) {
    throw new Error('Child command deadline exceeded');
  }

  if (child.exitCode !== 0) {
    throw new Error('Child command failed; inspect private redacted evidence');
  }
}
