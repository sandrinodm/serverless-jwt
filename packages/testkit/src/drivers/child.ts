import dns from 'node:dns';
import { performance } from 'node:perf_hooks';

import type { Observation } from '../scenarios/index.ts';
import type { DriverFailure } from './types.ts';

import { installClock, drainIo } from '../clock.ts';
import { startIssuer, issuerTransport } from '../issuer.ts';
import { fixtureKey } from '../keys.ts';
import { scenarios } from '../scenarios/index.ts';
import { adapterDriver } from './adapter.ts';
import { coreDriver } from './core.ts';

/**
 * Captures values without requiring thrown reasons to be Error objects (the null-throw attack).
 */
function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * Executes one scenario in a process whose unhandled rejections cannot leak into Vitest.
 */
async function main(): Promise<void> {
  const scenario = scenarios.find((entry) => entry.id === process.argv[2]);
  if (!scenario) {
    throw new Error('unknown scenario');
  }

  // Only this synthetic non-loopback hostname resolves to the loopback-only downgrade listener.
  // Resolution is fixture infrastructure; the verifier still receives an ordinary HTTP URL.
  const originalLookup = dns.lookup;
  dns.lookup = ((...args: unknown[]) => {
    if (args[0] !== 'legacy-issuer.test') {
      return Reflect.apply(originalLookup, dns, args);
    }

    const callback = args.at(-1) as (...values: unknown[]) => void;
    const options = args[1] as { all?: boolean } | undefined;
    queueMicrotask(() =>
      options?.all
        ? callback(null, [{ address: '127.0.0.1', family: 4 }])
        : callback(null, '127.0.0.1', 4),
    );
    return undefined;
  }) as typeof dns.lookup;

  const unhandled: string[] = [];
  process.on('unhandledRejection', (error) => unhandled.push(errorText(error)));
  const started = performance.now();
  const key = fixtureKey(2048);
  await using issuer = await startIssuer({ script: scenario.issuer });
  issuer.setScript((path) => ({
    json: path.startsWith('/.well-known')
      ? { issuer: issuer.url, jwks_uri: `${issuer.url}/jwks` }
      : { keys: [key.jwk] },
  }));
  const clock = installClock();
  if (!['core', 'adapter'].includes(process.argv[3] ?? '')) {
    throw new Error('unknown regression driver');
  }

  const transport = issuerTransport();
  try {
    const driver = (process.argv[3] === 'adapter' ? adapterDriver : coreDriver)(
      transport.fetch as unknown as typeof globalThis.fetch,
    );
    driver.create({ issuer: issuer.url, audience: 'api', ...scenario.options });
    /**
     * Observes completion after real I/O and advances every applicable deadline before proving a
     * pending operation.
     */
    const observe = async (operation: () => unknown): Promise<Observation> => {
      let result: Observation | undefined;
      void Promise.resolve()
        .then(operation)
        .then(
          (value) => {
            result = { outcome: 'accepted', value };
          },
          (error: unknown) => {
            const details = error as DriverFailure | null;
            result = {
              outcome: 'rejected',
              ...(details?.code ? { code: details.code } : {}),
              ...(details?.reason ? { reason: details.reason } : {}),
              ...(details?.status ? { status: details.status } : {}),
              message: details?.message ?? errorText(error),
            };
          },
        );
      await drainIo();
      if (result) {
        return result;
      }

      // I/O remains real; advance small increments first so scripted response delays can finish.
      for (let index = 0; index < 10 && !result; index++) {
        await clock.advance(1);
        await drainIo(2);
      }

      if (!result) {
        await clock.advance(60_001);
        await drainIo();
      }

      return (
        result ?? {
          outcome: 'never_settles',
          facts: { advancedMillis: 60_001, pendingTimers: clock.pendingTimers() },
        }
      );
    };
    const observation = await scenario.run({ driver, issuer, key, clock, observe });
    await drainIo(2);
    process.send?.({
      ...observation,
      hits: issuer.hits,
      unhandled,
      elapsed: performance.now() - started,
    });
  } finally {
    clock.close();
    await transport?.close();
  }
}

void main().then(
  () => {
    process.disconnect?.();
  },
  (error: unknown) => {
    process.send?.({ infrastructureError: errorText(error) });
    process.exitCode = 1;
    process.disconnect?.();
  },
);
