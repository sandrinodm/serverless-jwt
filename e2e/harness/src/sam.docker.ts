import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { image } from './docker.ts';
import { buildLambda } from './lambda-build.ts';
import { runtimePort, spawnRuntime } from './runtime.ts';

/**
 * Starts actual SAM REST/HTTP API emulation using the eligible pinned Lambda runtime and test CA.
 */
export async function startSam(options: {
  readonly directory: string;
  readonly issuer: string;
  readonly caFile: string;
  readonly network: string;
  readonly tokens: ReadonlyArray<string>;
  readonly logControl?: boolean;
  readonly logCapture?: 'buffer' | 'fingerprints';
  readonly trustCA?: boolean;
}): ReturnType<typeof spawnRuntime> {
  const { directory } = options;
  await buildLambda(join(directory, 'code'), options.caFile);
  mkdirSync(join(directory, 'state'), { recursive: true });
  writeFileSync(join(directory, 'aws-config'), '[default]\nregion=us-east-1\n');
  writeFileSync(
    join(directory, 'aws-credentials'),
    '[default]\naws_access_key_id=test\naws_secret_access_key=test\n',
    { mode: 0o600 },
  );
  writeFileSync(
    join(directory, 'template.json'),
    JSON.stringify(
      {
        AWSTemplateFormatVersion: '2010-09-09',
        Transform: 'AWS::Serverless-2016-10-31',
        Globals: {
          Function: {
            Runtime: 'nodejs24.x',
            CodeUri: './code',
            Timeout: 15,
            Architectures: ['x86_64'],
            Environment: {
              Variables: {
                ISSUER: options.issuer,
                E2E_LOG_CONTROL: options.logControl ? '1' : '0',
                NODE_EXTRA_CA_CERTS: options.trustCA === false ? '' : '/var/task/ca.crt',
              },
            },
          },
        },
        Resources: {
          Rest: {
            Type: 'AWS::Serverless::Function',
            Properties: {
              Handler: 'index.v1',
              Events: {
                Api: { Type: 'Api', Properties: { Path: '/rest', Method: 'ANY' } },
                Ready: { Type: 'Api', Properties: { Path: '/ready', Method: 'GET' } },
              },
            },
          },
          Http: {
            Type: 'AWS::Serverless::Function',
            Properties: {
              Handler: 'index.v2',
              Events: { Api: { Type: 'HttpApi', Properties: { Path: '/http', Method: 'ANY' } } },
            },
          },
        },
      },
      null,
      2,
    ),
  );
  const port = await runtimePort();
  /**
   * Reaps only SAM containers whose code mount exactly matches this test's private build directory.
   */
  const cleanup = (): void => {
    const ids = execFileSync('docker', ['ps', '-aq', '--filter', 'network=' + options.network], {
      encoding: 'utf8',
    })
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const owned = ids.filter((id) => {
      const mounts = JSON.parse(
        execFileSync('docker', ['inspect', id, '--format', '{{json .Mounts}}'], {
          encoding: 'utf8',
        }),
      ) as ReadonlyArray<{ readonly Source?: string; readonly Destination?: string }>;
      return mounts.some(
        (mount) =>
          mount.Destination === '/var/task' &&
          mount.Source === realpathSync(join(directory, 'code')),
      );
    });
    if (owned.length) {
      execFileSync('docker', ['rm', '-f', ...owned], { stdio: 'pipe' });
    }
  };
  try {
    const runtime = await spawnRuntime({
      command: process.env.E2E_PYTHON ?? 'python3',
      args: [
        new URL('../sam.py', import.meta.url).pathname,
        'local',
        'start-api',
        '--template',
        join(directory, 'template.json'),
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--docker-network',
        options.network,
        '--invoke-image',
        image('lambda'),
        '--skip-pull-image',
        '--force-image-build',
        '--warm-containers',
        'EAGER',
        '--layer-cache-basedir',
        join(directory, 'layers'),
      ],
      cwd: directory,
      url: 'http://127.0.0.1:' + port,
      tokens: options.tokens,
      ...(options.logCapture ? { logCapture: options.logCapture } : {}),
      readinessTimeout: 90_000,
      env: {
        PATH: process.env.PATH ?? '',
        DOCKER_HOST: process.env.DOCKER_HOST ?? 'unix:///var/run/docker.sock',
        SAM_CLI_TELEMETRY: '0',
        AWS_EC2_METADATA_DISABLED: 'true',
        AWS_CONFIG_FILE: join(directory, 'aws-config'),
        AWS_SHARED_CREDENTIALS_FILE: join(directory, 'aws-credentials'),
        AWS_DEFAULT_REGION: 'us-east-1',
        XDG_CONFIG_HOME: join(directory, 'state'),
        __SAM_CLI_APP_DIR: join(directory, 'state'),
        CI: '1',
      },
    });
    return {
      ...runtime,
      close: async (): Promise<void> => {
        try {
          await runtime.close();
        } finally {
          cleanup();
        }
      },
    };
  } catch (cause) {
    cleanup();
    throw cause;
  }
}
