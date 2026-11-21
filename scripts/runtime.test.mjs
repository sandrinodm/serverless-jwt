import { spawn } from 'node:child_process';
import { existsSync, mkdtempDisposableSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, it, vi } from 'vite-plus/test';

import { spawnRuntime } from '../e2e/harness/src/runtime.ts';

/**
 * Treats a terminated orphan awaiting the host's reaper as stopped on Linux.
 */
function running(pid) {
  try {
    process.kill(pid, 0);
    return (
      process.platform !== 'linux' ||
      !readFileSync('/proc/' + pid + '/stat', 'utf8').includes(') Z ')
    );
  } catch {
    return false;
  }
}

/**
 * Creates a real CLI descendant that holds inherited pipes and ignores graceful shutdown.
 */
function fixture(directory, { pipes = true, exit = false, log = '' } = {}) {
  const pidFile = join(directory, 'pids.json');
  const script = join(directory, 'cli.mjs');
  writeFileSync(
    script,
    `
    import { spawn } from 'node:child_process';
    import { writeFileSync } from 'node:fs';
    const child = spawn(process.execPath, ['-e', ${JSON.stringify("process.on('SIGTERM', () => {}); process.stdout.write('ready'); setInterval(() => {}, 1000);")}], {
      stdio: ['ignore', 'pipe', ${JSON.stringify(pipes ? 'inherit' : 'ignore')}],
    });
    child.stdout.once('data', () => {
      ${pipes ? 'child.stdout.pipe(process.stdout);' : 'child.stdout.destroy();'}
      process.stdout.write(${JSON.stringify(log)});
      writeFileSync(${JSON.stringify(pidFile)}, JSON.stringify([process.pid, child.pid]));
      ${exit ? 'process.exit(1);' : ''}
    });
    setInterval(() => {}, 1000);
  `,
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      if (!existsSync(pidFile)) {
        throw new Error('Not ready');
      }

      return new Response('ready');
    }),
  );
  return {
    options: {
      command: process.execPath,
      args: [script],
      cwd: directory,
      env: {},
      url: 'http://unused.test',
      tokens: [],
    },
    pids: () => JSON.parse(readFileSync(pidFile, 'utf8')),
  };
}

/**
 * Prevents a red regression from leaving its deliberately stubborn descendant alive.
 */
async function cleanup(pids, closed) {
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch (cause) {
      if (cause.code !== 'ESRCH') {
        throw cause;
      }
    }
  }

  await closed;
}

it('bounds CLI teardown and stops an inherited-pipe descendant without killing unrelated processes', async () => {
  using directory = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-runtime-'));
  const cli = fixture(directory.path);
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
  });
  let closed;
  try {
    const app = await spawnRuntime(cli.options);
    const pids = cli.pids();
    closed = app.close();
    expect(app.close()).toBe(closed);
    expect(await Promise.race([closed.then(() => true), delay(3500, false)])).toBe(true);
    expect(pids.every((pid) => !running(pid))).toBe(true);
    expect(running(unrelated.pid)).toBe(true);
  } finally {
    unrelated.kill('SIGKILL');
    await cleanup(existsSync(join(directory.path, 'pids.json')) ? cli.pids() : [], closed);
  }
});

it('stops descendants even when the CLI closes its inherited pipes before they exit', async () => {
  using directory = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-runtime-'));
  const cli = fixture(directory.path, { pipes: false });
  let closed;
  try {
    const app = await spawnRuntime(cli.options);
    closed = app.close();
    await closed;
    await expect.poll(() => cli.pids().every((pid) => !running(pid))).toBe(true);
  } finally {
    await cleanup(cli.pids(), closed);
  }
});

it('cleans up descendants when the CLI exits before readiness', async () => {
  using directory = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-runtime-'));
  const cli = fixture(directory.path, { exit: true });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('Not ready');
    }),
  );
  try {
    await expect(spawnRuntime(cli.options)).rejects.toThrow('Runtime exited before readiness');
    expect(cli.pids().every((pid) => !running(pid))).toBe(true);
  } finally {
    await cleanup(cli.pids());
  }
});

it('cleans up descendants when readiness times out', async () => {
  using directory = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-runtime-'));
  const cli = fixture(directory.path);
  let elapsed = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => elapsed);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      if (existsSync(join(directory.path, 'pids.json'))) {
        elapsed += 5000;
      }

      throw new Error('Not ready');
    }),
  );
  try {
    await expect(spawnRuntime(cli.options)).rejects.toThrow('Runtime readiness deadline exceeded');
    expect(cli.pids().every((pid) => !running(pid))).toBe(true);
  } finally {
    await cleanup(cli.pids());
  }
});

it('terminates the final stream wait and still writes private redacted logs when signals do not close pipes', async () => {
  using directory = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-runtime-'));
  const cli = fixture(directory.path, { log: 'private ordinary output\n' });
  let closed;
  try {
    const app = await spawnRuntime(cli.options);
    const [pid] = cli.pids();
    const kill = process.kill.bind(process);
    // Model an unresponsive owned group while retaining real child streams and log capture.
    vi.spyOn(process, 'kill').mockImplementation((target, signal) =>
      target === -pid ? true : kill(target, signal),
    );
    closed = app.close();
    await expect(closed).rejects.toThrow(
      'Runtime teardown deadline exceeded or process tree could not be stopped',
    );
    expect(readFileSync(join('reports/e2e', 'runtime-' + pid + '.log'), 'utf8')).toBe(
      'private ordinary output\n',
    );
  } finally {
    vi.restoreAllMocks();
    await cleanup(
      cli.pids(),
      closed?.catch(() => {}),
    );
  }
});

for (const [name, log, tokens] of [
  ['credential', 'synthetic-private-credential\n', ['synthetic-private-credential']],
  ['overflow', 'x\n'.repeat(35_000), []],
]) {
  it(
    'retains the private log ' + name + ' failure after stopping the full process tree',
    async () => {
      using directory = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-runtime-'));
      const cli = fixture(directory.path, { log });
      let closed;
      try {
        const app = await spawnRuntime({ ...cli.options, tokens });
        closed = app.close();
        await expect(closed).rejects.toThrow(
          'Server log contains a credential or exceeds the private buffer',
        );
        expect(cli.pids().every((pid) => !running(pid))).toBe(true);
        const output = readFileSync(
          join('reports/e2e', 'runtime-' + cli.pids()[0] + '.log'),
          'utf8',
        );
        expect(output.length).toBeLessThanOrEqual(65536);
        for (const token of tokens) {
          expect(output).not.toContain(token);
        }
      } finally {
        await cleanup(
          cli.pids(),
          closed?.catch(() => {}),
        );
      }
    },
  );
}
