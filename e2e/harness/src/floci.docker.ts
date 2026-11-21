import './docker.ts';
import type { StartedNetwork } from 'testcontainers';

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GenericContainer, Wait } from 'testcontainers';

import { captureDockerLogs, dockerLogs, privateCommand } from './docker-logs.ts';
import { dockerPort } from './docker-port.ts';
import { image } from './docker.ts';
import { buildLambda } from './lambda-build.ts';

/**
 * Starts real account-free Floci REST/HTTP APIs and its digest-pinned Lambda Docker executor.
 */
export async function startFloci(options: {
  readonly directory: string;
  readonly issuer: string;
  readonly caFile: string;
  readonly network: StartedNetwork;
  readonly tokens: ReadonlyArray<string>;
  readonly logControl?: boolean;
  readonly logCapture?: 'buffer' | 'fingerprints';
  readonly trustCA?: boolean;
  readonly concurrency?: number;
  readonly nativeControl?: boolean;
}): Promise<{
  readonly restURL: string;
  readonly httpURL: string;
  readonly verifyImages: (minimum?: number, maximum?: number) => void;
  readonly runtimeStats: () => ReadonlyArray<{
    readonly id: string;
    readonly rssKiB: number;
    readonly pssKiB: number | undefined;
    readonly threads: number;
  }>;
  readonly close: () => Promise<void>;
}> {
  const namespace = 'serverless-jwt-' + randomUUID().slice(0, 12);
  const socket = process.env.DOCKER_HOST?.replace(/^unix:\/\//, '') ?? '/var/run/docker.sock';
  const code = join(options.directory, 'code');
  await buildLambda(code, options.caFile);
  const stateFile = join(options.directory, 'floci.json');
  const python = process.env.E2E_PYTHON ?? 'python3';
  const script = new URL('../floci.py', import.meta.url).pathname;
  let container: Awaited<ReturnType<GenericContainer['start']>> | undefined;
  let created = false;
  let diagnosticLine = '';
  const diagnosticMarkers: ReadonlyArray<string> = [
    'OutOfMemoryError',
    'unable to create native thread',
    'pthread_create',
    'EAGAIN',
    'TooManyRequests',
    'RejectedExecution',
    'Read timed out',
    'Connection refused',
    'Connection reset',
    'TimeoutException',
    'timed out',
    'BindException',
    'Address already in use',
    'Failed to create',
    'Failed to start',
    'No such file',
    'NoSuchElementException',
    'ConcurrentModificationException',
    'IllegalStateException',
    'DockerException',
    'Runtime.ExitError',
    'init timeout',
    'initialization',
  ];
  const diagnostics: Record<string, number> = {};
  /**
   * Emits only fixed exception classifications from private lines, never raw native diagnostics.
   */
  const capture = (chunk: Buffer): void => {
    diagnosticLine += chunk.toString();
    const lines = diagnosticLine.split('\n');
    diagnosticLine = lines.pop() ?? '';
    if (diagnosticLine.length > 65_536) {
      diagnostics['diagnostic-line-overflow'] = 1;
      diagnosticLine = '';
    }

    for (const line of lines) {
      for (const marker of diagnosticMarkers) {
        if (line.toLowerCase().includes(marker.toLowerCase())) {
          diagnostics[marker] = (diagnostics[marker] ?? 0) + 1;
        }
      }
    }
  };
  const logs = dockerLogs(options.tokens, options.logCapture, capture);
  /**
   * Lists only this run's live executor containers, never unrelated daemon resources.
   */
  const executors = (): string[] =>
    execFileSync('docker', ['ps', '-q', '--filter', 'name=' + namespace + '-lambda'], {
      encoding: 'utf8',
    })
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  /**
   * Proves Floci actually launched the immutable runtime image rather than a floating fallback.
   */
  const verifyImages = (minimum = 2, maximum = 2): void => {
    const expected = execFileSync(
      'docker',
      ['image', 'inspect', image('lambda'), '--format', '{{.Id}}'],
      { encoding: 'utf8' },
    ).trim();
    const containers = executors();
    if (containers.length < minimum || containers.length > maximum) {
      throw new Error('Owned Lambda runtime count differs from the expected bounds');
    }

    const images = containers.map((id) =>
      execFileSync('docker', ['inspect', id, '--format', '{{.Image}}'], {
        encoding: 'utf8',
      }).trim(),
    );
    if (!images.every((actual) => actual === expected)) {
      throw new Error('Floci Lambda runtime image differs from pinned digest');
    }

    mkdirSync('reports/e2e', { recursive: true });
    writeFileSync(
      'reports/e2e/floci-images-' + namespace + '.json',
      JSON.stringify({ expected, containers, images }, null, 2),
    );
  };
  /**
   * Measures real owned runtime process RSS and threads without collecting command lines or
   * credentials.
   */
  const runtimeStats = (): ReadonlyArray<{
    readonly id: string;
    readonly rssKiB: number;
    readonly pssKiB: number | undefined;
    readonly threads: number;
  }> =>
    executors().map((id) => {
      const rows = execFileSync('docker', ['top', id, '-eo', 'pid,rss,nlwp'], { encoding: 'utf8' })
        .trim()
        .split('\n')
        .slice(1);
      const values = rows.map((row) => row.trim().split(/\s+/).map(Number));
      const pss = values.map((row) => {
        try {
          return Number(
            /^Pss:\s+(\d+)/m.exec(readFileSync('/proc/' + row[0] + '/smaps_rollup', 'utf8'))?.[1],
          );
        } catch {
          return Number.NaN;
        }
      });
      return {
        id,
        pssKiB: pss.every(Number.isFinite) ? pss.reduce((a, b) => a + b, 0) : undefined,
        rssKiB: values.reduce((total, row) => total + (row[1] ?? 0), 0),
        threads: values.reduce((total, row) => total + (row[2] ?? 0), 0),
      };
    });
  /**
   * Deletes only the uniquely named test resources, containers and volumes from this invocation.
   */
  const close = async (): Promise<void> => {
    let failed = false;
    /**
     * Runs every cleanup stage even if an earlier stage loses output or cannot reap its resource.
     */
    const attempt = async (action: () => void | Promise<void>): Promise<void> => {
      try {
        await action();
      } catch {
        failed = true;
      }
    };
    // Stop writers before taking complete non-following snapshots, retaining their containers.
    let runtimes: string[] = [];
    await attempt(async () => {
      runtimes = (
        await privateCommand('docker', ['ps', '-aq', '--filter', 'name=' + namespace + '-lambda'])
      )
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    });
    for (const id of runtimes) {
      await attempt(async () => {
        await privateCommand('docker', ['stop', '--time', '5', id]);
      });
      await attempt(() => captureDockerLogs(id, logs.attach));
    }

    if (created) {
      await attempt(async () => {
        await privateCommand(python, [script, 'delete', stateFile], 60_000);
      });
    }

    await attempt(async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          container?.stop({ timeout: 5_000 }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('Floci container stop exceeded its deadline')),
              10_000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    });
    // Floci owns executor code volumes; always try both resource classes after any earlier failure.
    await attempt(async () => {
      const owned = (await privateCommand('docker', ['ps', '-aq', '--filter', 'name=' + namespace]))
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      if (owned.length) {
        await privateCommand('docker', ['rm', '-f', ...owned]);
      }
    });
    await attempt(async () => {
      const volumes = (
        await privateCommand('docker', [
          'volume',
          'ls',
          '-q',
          '--filter',
          'label=floci_namespace=' + namespace,
        ])
      )
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      if (volumes.length) {
        await privateCommand('docker', ['volume', 'rm', ...volumes]);
      }
    });
    await attempt(() => {
      mkdirSync('reports/e2e', { recursive: true });
      writeFileSync(
        'reports/e2e/floci-diagnostics-' + namespace + '.json',
        JSON.stringify({ nativeControl: options.nativeControl ?? false, diagnostics }, null, 2),
      );
    });
    await attempt(() => logs.finish('reports/e2e/floci-' + namespace + '.log'));
    if (failed) {
      throw new Error('Floci cleanup or complete private log capture failed');
    }
  };
  try {
    container = await new GenericContainer(image('floci'))
      .withName(namespace)
      .withNetwork(options.network)
      .withExposedPorts({ container: 4566, host: await dockerPort() })
      .withBindMounts([{ source: socket, target: '/var/run/docker.sock', mode: 'rw' }])
      .withEnvironment({
        FLOCI_DOCKER_RESOURCE_NAMESPACE: namespace,
        FLOCI_DOCKER_MAX_CONNECTIONS: String(Math.max(128, (options.concurrency ?? 8) * 4)),
        JAVA_TOOL_OPTIONS: '-Xmx768m',
        FLOCI_SERVICES_LAMBDA_CONTAINER_NAME_PREFIX: namespace + '-lambda',
        FLOCI_SERVICES_LAMBDA_REGION_CONCURRENCY_LIMIT: String(options.concurrency ?? 1000),
        FLOCI_SERVICES_LAMBDA_WARM_POOL_MAX_PER_FUNCTION: String(options.concurrency ?? 8),
        FLOCI_SERVICES_LAMBDA_WARM_POOL_MAX_TOTAL: String((options.concurrency ?? 8) * 2),
        FLOCI_SERVICES_DOCKER_NETWORK: options.network.getName(),
        FLOCI_SERVICES_LAMBDA_DOCKER_NETWORK: options.network.getName(),
        FLOCI_SERVICES_LAMBDA_DOCKER_HOST_OVERRIDE: namespace,
        FLOCI_SERVICES_LAMBDA_ECR_BASE_URI: 'invalid.invalid/blocked',
        FLOCI_SERVICES_LAMBDA_RUNTIME_IMAGES__NODEJS24_X__: image('lambda'),
      })
      .withLogConsumer((stream) => {
        logs.attach(stream);
      })
      .withWaitStrategy(Wait.forHttp('/_floci/health', 4566))
      .withStartupTimeout(60_000)
      .start();
    const endpoint = 'http://127.0.0.1:' + container.getMappedPort(4566);
    writeFileSync(
      stateFile,
      JSON.stringify({
        namespace,
        endpoint,
        code,
        issuer: options.issuer,
        logControl: options.logControl ?? false,
        trustCA: options.trustCA ?? true,
        nativeControl: options.nativeControl ?? false,
      }),
      { mode: 0o600 },
    );
    created = true;
    execFileSync(python, [script, 'create', stateFile], { stdio: 'pipe', timeout: 90_000 });
    const state = JSON.parse(readFileSync(stateFile, 'utf8')) as {
      readonly restURL: string;
      readonly httpURL: string;
    };
    return { restURL: state.restURL, httpURL: state.httpURL, verifyImages, runtimeStats, close };
  } catch {
    await close();
    throw new Error('Floci startup failed');
  }
}
