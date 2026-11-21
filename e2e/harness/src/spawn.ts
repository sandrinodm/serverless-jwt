import { fork } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { privateLogs } from './logs.ts';
import { applicationDirectory } from './release.ts';
export { redactLogs } from './logs.ts';

/**
 * Spawns the private Express example with readiness deadline, bounded logs and guaranteed reaping.
 */
export async function spawnExample(
  issuer: string,
  tokens: ReadonlyArray<string>,
  jwksUri?: string,
  policy?: { readonly node?: string; readonly keys?: Readonly<Record<string, number>> },
): Promise<{ readonly url: string; readonly close: () => Promise<void> }> {
  const child = fork(join(applicationDirectory('reference-express'), 'src/app.ts'), [], {
    execPath: policy?.node ?? process.execPath,
    execArgv: process.env.E2E_FROM_TARBALLS ? [] : ['--conditions=source'],
    env: {
      ...process.env,
      E2E_REFERENCE_APP: '1',
      ...(policy?.keys ? { E2E_KEY_POLICY: JSON.stringify(policy.keys) } : {}),
      ISSUER: issuer,
      ...(jwksUri ? { JWKS_URI: jwksUri } : {}),
      NODE_TLS_REJECT_UNAUTHORIZED: '1',
      NODE_EXTRA_CA_CERTS: fileURLToPath(
        new URL('../../../packages/testkit/fixtures/ca.crt', import.meta.url),
      ),
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const logs = privateLogs(tokens);
  child.stdout?.on('data', logs.capture);
  child.stderr?.on('data', logs.capture);
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
  /**
   * Reaps the child and writes only checked, redacted logs.
   */
  const close = async (): Promise<void> => {
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
    try {
      await closed;
    } finally {
      clearTimeout(timer);
    }

    logs.finish(`reports/e2e/server-${child.pid}.log`);
  };
  try {
    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Server readiness deadline exceeded')),
        10_000,
      );
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('exit', () => {
        clearTimeout(timer);
        reject(new Error('Server exited before readiness'));
      });
      child.once('message', (message: unknown) => {
        clearTimeout(timer);
        const ready = (message as { ready?: unknown }).ready;
        if (typeof ready !== 'string') {
          reject(new Error('Invalid readiness message'));
        } else {
          resolve(ready);
        }
      });
    });
    const ready = await fetch(url + '/ready', { signal: AbortSignal.timeout(2000) });
    if (ready.status !== 200 || (await ready.text()) !== 'ready') {
      throw new Error('Readiness route failed');
    }

    return { url, close };
  } catch (cause) {
    await close();
    throw cause;
  }
}
