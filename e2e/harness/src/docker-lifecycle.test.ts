import type * as ChildProcess from 'node:child_process';
import type { Readable } from 'node:stream';

import { mkdtempDisposableSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test';

import type * as DockerLogs from './docker-logs.ts';

/**
 * External services are substituted at their transport boundary; lifecycle bodies remain real.
 */
const controls = vi.hoisted(() => ({
  stream: undefined as PassThrough | undefined,
  directory: '',
  startupFailure: false,
  stopFailure: false,
  stopStall: false,
  logError: false,
  missingEOF: false,
  late: '',
  stop: vi.fn(),
  transportClose: vi.fn(),
  certificatesClose: vi.fn(),
  commands: [] as Array<{
    readonly command: string;
    readonly args: ReadonlyArray<string>;
    readonly options: unknown;
  }>,
  cleanupFailure: false,
}));

vi.mock('./docker.ts', () => ({ image: (): string => 'synthetic' }));
vi.mock('./docker-port.ts', () => ({ dockerPort: async (): Promise<number> => 12345 }));
vi.mock('./lambda-build.ts', () => ({ buildLambda: async (): Promise<void> => {} }));
vi.mock('./tls.ts', () => ({
  dockerCertificates: (): { readonly directory: string; readonly close: () => void } => ({
    directory: controls.directory,
    close: controls.certificatesClose,
  }),
}));
vi.mock('../../../packages/testkit/src/issuer.ts', () => ({
  issuerTransport: (): { readonly fetch: () => Promise<Response>; readonly close: () => void } => ({
    fetch: async (): Promise<Response> =>
      new Response(JSON.stringify({ issuer: 'https://localhost:12345/realms/serverless-jwt' })),
    close: controls.transportClose,
  }),
}));
vi.mock('testcontainers', () => {
  /**
   * Supplies a real readable transport and independently timed stop and log EOF boundaries.
   */
  class GenericContainer {
    withExposedPorts(): this {
      return this;
    }
    withBindMounts(): this {
      return this;
    }
    withEnvironment(): this {
      return this;
    }
    withCommand(): this {
      return this;
    }
    withWaitStrategy(): this {
      return this;
    }
    withStartupTimeout(): this {
      return this;
    }
    withName(): this {
      return this;
    }
    withNetwork(): this {
      return this;
    }
    withLogConsumer(consumer: (stream: Readable) => void): this {
      controls.stream = new PassThrough();
      consumer(controls.stream);
      return this;
    }
    async start(): Promise<{
      readonly getMappedPort: () => number;
      readonly stop: () => Promise<void>;
    }> {
      if (controls.logError) {
        controls.stream?.destroy(new Error(TOKEN));
      }

      if (controls.startupFailure) {
        setTimeout(() => controls.stream?.end(controls.late), 5);
        throw new Error('synthetic startup failure');
      }

      return {
        getMappedPort: (): number => 12345,
        stop: async (): Promise<void> => {
          controls.stop();
          if (controls.stopStall) {
            return new Promise<never>(() => {});
          }

          if (!controls.missingEOF) {
            setTimeout(() => controls.stream?.end(controls.late), 5);
          }

          if (controls.stopFailure) {
            throw new Error(TOKEN);
          }
        },
      };
    }
  }
  return { GenericContainer, Wait: { forLogMessage: vi.fn(), forHttp: vi.fn() } };
});
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof ChildProcess>()),
  execFileSync: (command: string, args: ReadonlyArray<string>, options: unknown): string => {
    controls.commands.push({ command, args, options });
    if (controls.cleanupFailure && args[0] === 'rm') {
      throw new Error(TOKEN);
    }

    if (args[0] === 'ps') {
      return 'owned-executor\n';
    }

    if (args[0] === 'volume' && args[1] === 'ls') {
      return 'owned-volume\n';
    }

    if (args[1] === 'create') {
      const file = args[2] ?? '';
      writeFileSync(
        file,
        JSON.stringify({
          ...JSON.parse(readFileSync(file, 'utf8')),
          restURL: 'http://localhost/rest',
          httpURL: 'http://localhost/http',
        }),
      );
    }

    return '';
  },
}));
vi.mock('./docker-logs.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof DockerLogs>()),
  captureDockerLogs: async (): Promise<void> => {
    throw new Error(TOKEN);
  },
  privateCommand: async (
    command: string,
    args: ReadonlyArray<string>,
    timeout = 10_000,
  ): Promise<string> => {
    controls.commands.push({ command, args, options: { timeout, detached: true } });
    if (controls.cleanupFailure && args[0] === 'rm') {
      throw new Error(TOKEN);
    }

    if (args[0] === 'ps') {
      return 'owned-executor\n';
    }

    if (args[0] === 'volume' && args[1] === 'ls') {
      return 'owned-volume\n';
    }

    if (args[0] === 'rm' && controls.stopStall) {
      controls.stream?.end();
    }

    return '';
  },
}));

import { startFloci } from './floci.docker.ts';
import { startKeycloak } from './keycloak.docker.ts';

/**
 * This credential must appear only in private synthetic input and never in failures or artifacts.
 */
const TOKEN = 'e30.eyJzdWIiOiJwcml2YXRlIn0.signature';

beforeEach(() => {
  vi.clearAllMocks();
  controls.startupFailure = false;
  controls.stopFailure = false;
  controls.stopStall = false;
  controls.logError = false;
  controls.missingEOF = false;
  controls.late = '';
  controls.commands = [];
  controls.cleanupFailure = false;
});
afterEach(() => {
  vi.useRealTimers();
});

it.each(['late-token', 'stream-error', 'startup-failure', 'stop-failure'] as const)(
  'actual Keycloak lifecycle drains and fails privately on %s',
  async (mode) => {
    using directory = mkdtempDisposableSync(join(tmpdir(), 'jwt-keycloak-lifecycle-'));
    controls.directory = directory.path;
    controls.startupFailure = mode === 'startup-failure';
    controls.stopFailure = mode === 'stop-failure';
    controls.logError = mode === 'stream-error';
    controls.late = mode === 'stream-error' ? '' : TOKEN;
    const action = async (): Promise<void> => {
      const app = await startKeycloak();
      await app.close();
    };
    await expect(action()).rejects.toThrow(
      mode === 'stream-error' ? 'complete output' : 'credential',
    );
    expect(controls.transportClose).toHaveBeenCalledOnce();
    expect(controls.certificatesClose).toHaveBeenCalledOnce();
    const artifact = readFileSync('reports/e2e/keycloak.log', 'utf8');
    expect(artifact).not.toContain(TOKEN);
    expect(mode === 'stream-error' || /\[token:[a-f0-9]{12}\]/.test(artifact)).toBe(true);
  },
);

it('actual Keycloak lifecycle bounds missing EOF after a successful stop', async () => {
  using directory = mkdtempDisposableSync(join(tmpdir(), 'jwt-keycloak-stall-'));
  controls.directory = directory.path;
  controls.missingEOF = true;
  vi.useFakeTimers();
  const app = await startKeycloak();
  const result = app.close().catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(5_001);
  expect(await result).toEqual(new Error('Docker log transport did not capture complete output'));
  expect(controls.stop).toHaveBeenCalledOnce();
  expect(controls.transportClose).toHaveBeenCalledOnce();
  expect(controls.stream?.destroyed).toBe(true);
});

it.each(['removal-error', 'stop-error', 'stop-stall'] as const)(
  'actual Floci cleanup continues after log failure and %s',
  async (mode) => {
    using directory = mkdtempDisposableSync(join(tmpdir(), 'jwt-floci-cleanup-'));
    controls.cleanupFailure = mode === 'removal-error';
    controls.stopFailure = mode === 'stop-error';
    controls.stopStall = mode === 'stop-stall';
    if (controls.stopStall) {
      vi.useFakeTimers();
    }

    const app = await startFloci({
      directory: directory.path,
      issuer: 'https://issuer.test',
      caFile: join(directory.path, 'unused'),
      network: { getName: (): string => 'owned' } as Parameters<typeof startFloci>[0]['network'],
      tokens: [],
    });
    const result = app.close().catch((error: unknown) => error);
    if (controls.stopStall) {
      await vi.advanceTimersByTimeAsync(10_001);
    }

    expect(await result).toEqual(new Error('Floci cleanup or complete private log capture failed'));
    expect(controls.stop).toHaveBeenCalledOnce();
    expect(controls.commands.some(({ args }) => args[1] === 'delete')).toBe(true);
    expect(controls.commands.some(({ args }) => args[0] === 'rm')).toBe(true);
    expect(controls.commands.some(({ args }) => args[0] === 'volume' && args[1] === 'rm')).toBe(
      true,
    );
    const teardown = controls.commands.filter(({ args }) => args[1] !== 'create');
    for (const { args, options } of teardown) {
      expect(options).toMatchObject({
        timeout: args[1] === 'delete' ? 60_000 : 10_000,
        detached: true,
      });
    }

    for (const file of readdirSync('reports/e2e').filter((name) => name.startsWith('floci-'))) {
      expect(readFileSync(join('reports/e2e', file), 'utf8')).not.toContain(TOKEN);
    }
  },
);
