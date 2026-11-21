import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import type { Observation } from '../scenarios/index.ts';

/**
 * Hard real-time bound for isolated regression hangs; after expiry the child is killed and reaped.
 */
const WATCHDOG_MILLIS = 15_000;

/**
 * Runs a scenario in a clean Node child with certificate verification enabled and a test-only CA.
 */
export function runScenario(id: string, driver: 'core' | 'adapter' = 'core'): Promise<Observation> {
  return new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(new URL('./child.ts', import.meta.url)), [id, driver], {
      execArgv: [],
      serialization: 'advanced',
      env: {
        ...process.env,
        NODE_TLS_REJECT_UNAUTHORIZED: '1',
        NODE_EXTRA_CA_CERTS: fileURLToPath(new URL('../../fixtures/ca.crt', import.meta.url)),
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let observation: Observation | undefined;
    let infrastructureError: string | undefined;
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('message', (message: Observation & { infrastructureError?: string }) => {
      if (message.infrastructureError) {
        infrastructureError = message.infrastructureError;
      } else {
        observation = message;
      }
    });
    const watchdog = setTimeout(() => {
      observation = { outcome: 'deadline_exceeded' };
      child.kill('SIGKILL');
    }, WATCHDOG_MILLIS);
    child.once('error', (error) => {
      clearTimeout(watchdog);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(watchdog);
      if (
        infrastructureError ||
        !observation ||
        (code !== 0 && observation.outcome !== 'deadline_exceeded')
      ) {
        reject(
          new Error(
            `${id}: ${infrastructureError ?? stderr ?? 'child exited without observation'}`,
          ),
        );
        return;
      }

      resolve(observation);
    });
  });
}
