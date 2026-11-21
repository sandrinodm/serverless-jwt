import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vite-plus/test';

import { capturePrivateOutput, runPrivateCommand } from './private-process.mjs';

const synthetic = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.signature';

/**
 * Executes a real logging child, retaining only the safe final outcome and private evidence.
 */
async function evidence(source, tokens = []) {
  const directory = mkdtempSync(join(tmpdir(), 'jwt-private-output-'));
  const path = join(directory, 'child.log');
  const child = spawn(process.execPath, ['-e', source], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  const capture = capturePrivateOutput(child, path, tokens);
  let failure;
  try {
    await capture.closed;
    try {
      await capture.finish();
    } catch (error) {
      failure = error;
    }

    return {
      text: readFileSync(path, 'utf8'),
      failure,
      mode: statSync(path).mode & 0o777,
      stopped: child.exitCode !== null || child.signalCode !== null,
    };
  } finally {
    await capture.finish().catch(() => {});
    rmSync(directory, { recursive: true, force: true });
  }
}

test('real successful child retains ordinary stdout/stderr as private evidence', async () => {
  const result = await evidence(
    "process.stdout.write('ordinary stdout\\n'); process.stderr.write('ordinary stderr\\n')",
  );
  assert.equal(result.failure, undefined);
  assert.equal(result.mode, 0o600);
  assert.equal(result.stopped, true);
  assert.equal(result.text, 'ordinary stdout\nordinary stderr\n');
});

for (const stream of ['stdout', 'stderr']) {
  test('real logging child rejects unknown JWT split across ' + stream + ' chunks', async () => {
    const result = await evidence(
      `process.${stream}.write(${JSON.stringify(synthetic.slice(0, 23))}); setTimeout(() => process.${stream}.write(${JSON.stringify(synthetic.slice(23))}), 10)`,
    );
    assert.equal(
      result.failure?.message,
      'Child log contains a credential or exceeds the private buffer',
    );
    assert.equal(result.text.includes(synthetic), false);
    assert.match(result.text, /\[token:[a-f0-9]{12}\]/);
    assert.equal(result.stopped, true);
  });
}

test('late registered minted opaque credentials are redacted even on an early failing child', async () => {
  const tokens = [];
  const secret = 'opaque-minted-credential';
  const pending = evidence(
    `process.stderr.write(${JSON.stringify(secret)}); process.exitCode = 7`,
    tokens,
  );
  tokens.push(secret);
  const result = await pending;
  assert.equal(
    result.failure?.message,
    'Child log contains a credential or exceeds the private buffer',
  );
  assert.equal(result.text.includes(secret), false);
  assert.match(result.text, /\[token:/);
});

test('overflow rejects a one MiB logging child without persisting any raw output', async () => {
  const result = await evidence(
    `process.stdout.write('x'.repeat(1048576) + ${JSON.stringify(synthetic)})`,
  );
  assert.equal(
    result.failure?.message,
    'Child log contains a credential or exceeds the private buffer',
  );
  assert.equal(result.text, '[private output exceeded 65536 bytes; evidence rejected]\n');
  assert.equal(result.text.includes(synthetic), false);
  assert.equal(result.stopped, true);
});

for (const [name, source, expected] of [
  [
    'ordinary failure',
    "process.stderr.write('ordinary failure'); process.exitCode=7",
    'Child command failed; inspect private redacted evidence',
  ],
  [
    'JWT build output',
    `process.stderr.write(${JSON.stringify(synthetic)})`,
    'Child log contains a credential or exceeds the private buffer',
  ],
  [
    'early JWT failure',
    `process.stdout.write(${JSON.stringify(synthetic)}); process.exitCode=7`,
    'Child log contains a credential or exceeds the private buffer',
  ],
  [
    'overflow',
    "process.stdout.write('x'.repeat(1048576))",
    'Child log contains a credential or exceeds the private buffer',
  ],
]) {
  test('build/install capture rejects ' + name + ' with token-free diagnostics', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'jwt-private-command-'));
    const path = join(directory, 'child.log');
    try {
      await assert.rejects(runPrivateCommand(process.execPath, ['-e', source], {}, path), {
        message: expected,
      });
      assert.equal(readFileSync(path, 'utf8').includes(synthetic), false);
      assert.equal(statSync(path).mode & 0o777, 0o600);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test('spawn failure is fixed and still produces private evidence', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'jwt-private-command-'));
  try {
    const path = join(directory, 'child.log');
    await assert.rejects(runPrivateCommand(join(directory, 'missing-command'), [], {}, path), {
      message: 'Child process could not start',
    });
    assert.equal(readFileSync(path, 'utf8'), '');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('teardown stops a pipe-owning descendant after its launcher exits and is idempotent', async () => {
  if (process.platform === 'win32') {
    return;
  }

  const directory = mkdtempSync(join(tmpdir(), 'jwt-private-descendant-'));
  const path = join(directory, 'child.log');
  const ready = join(directory, 'ready');
  const descendant = `process.on('SIGTERM',()=>{}); require('node:fs').writeFileSync(${JSON.stringify(ready)},'ready'); setInterval(()=>{},1000)`;
  const launcher = `const {spawn}=require('node:child_process'); const descendant=spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:['ignore',process.stdout,process.stderr]}); while(!require('node:fs').existsSync(${JSON.stringify(ready)})) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10); } process.stdout.write(String(descendant.pid)); descendant.unref()`;
  const child = spawn(process.execPath, ['-e', launcher], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  const capture = capturePrivateOutput(child, path);
  try {
    await new Promise((resolve) => child.once('exit', resolve));
    const first = capture.finish();
    assert.equal(first, capture.finish());
    await first;
    const pid = Number(readFileSync(path, 'utf8'));
    assert.ok(Number.isInteger(pid) && pid > 0);
    try {
      process.kill(pid, 0);
      // Orphan zombies have stopped; PID 1 owns their final reap in containers.
      assert.equal(readFileSync(`/proc/${pid}/stat`, 'utf8').split(' ')[2], 'Z');
    } catch (error) {
      assert.equal(error.code, 'ESRCH');
    }
  } finally {
    await capture.finish().catch(() => {});
    rmSync(directory, { recursive: true, force: true });
  }
});

test('reused evidence files regain private permissions', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'jwt-private-reused-'));
  const path = join(directory, 'child.log');
  writeFileSync(path, 'previous evidence', { mode: 0o644 });
  try {
    await runPrivateCommand(process.execPath, ['-e', "process.stdout.write('ordinary')"], {}, path);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(readFileSync(path, 'utf8'), 'ordinary');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
