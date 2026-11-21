import { mkdtempDisposableSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vite-plus/test';

import { fixtureKey } from '../../../packages/testkit/src/keys.ts';
import { mintToken } from '../../../packages/testkit/src/tokens.ts';
import { privateLogs, redactLogs } from './logs.ts';
import { runtimePort, spawnRuntime } from './runtime.ts';

it('redacts split credentials, late registered tokens and short JWT signatures before writing', () => {
  using directory = mkdtempDisposableSync(join(tmpdir(), 'jwt-private-logs-'));
  const tokens: string[] = [];
  const logs = privateLogs(tokens);
  logs.capture(Buffer.from('before eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzIn0.x opaque-'));
  logs.capture(Buffer.from('secret after'));
  tokens.push('opaque-secret');
  const file = join(directory.path, 'server.log');
  expect(() => logs.finish(file)).toThrow('Server log contains a credential');
  const output = readFileSync(file, 'utf8');
  expect(output).not.toContain('opaque-secret');
  expect(output).not.toContain('eyJ');
  expect(output.match(/\[token:/g)).toHaveLength(2);
  expect(statSync(file).mode & 0o777).toBe(0o600);
  expect(() => logs.finish(file)).not.toThrow();
});

it('fails closed on overflow without discarding an earlier leaked token', () => {
  using directory = mkdtempDisposableSync(join(tmpdir(), 'jwt-log-overflow-'));
  const logs = privateLogs(['credential']);
  logs.capture('credential');
  logs.capture(Buffer.alloc(65_536, 'x'));
  const file = join(directory.path, 'server.log');
  expect(() => logs.finish(file)).toThrow('Server log contains a credential');
  expect(readFileSync(file, 'utf8')).toBe('[private log buffer exceeded; output discarded]\n');
  expect(redactLogs('safe startup version 1.2.3', [])).toEqual({
    text: 'safe startup version 1.2.3',
    leaked: false,
  });
});

// A real application deliberately logs a real minted token through stdout; collection must fail.
it('keeps the credential detector active for other real handler and CLI output', async () => {
  const token = await mintToken({
    key: fixtureKey(2048),
    header: {},
    payload: {
      iss: 'https://issuer.example',
      aud: 'api',
      sub: 'private-log-control',
      exp: Math.floor(Date.now() / 1000) + 300,
    },
  });
  const port = await runtimePort();
  const code =
    "import {createServer} from 'node:http'; const server=createServer((_request,response)=>{ console.log(process.env.E2E_LOG_CONTROL); response.end('ready'); }); server.listen(Number(process.env.PORT),'127.0.0.1'); process.on('SIGTERM',()=>{server.closeAllConnections();server.close();});";
  const app = await spawnRuntime({
    command: process.execPath,
    args: ['--input-type=module', '-e', code],
    cwd: process.cwd(),
    env: { PORT: String(port), E2E_LOG_CONTROL: token },
    url: 'http://127.0.0.1:' + port,
    tokens: [token],
  });
  await expect(app.close()).rejects.toThrow('Server log contains a credential');
  const artifact = readFileSync(app.logFile, 'utf8');
  expect(artifact.includes(token)).toBe(false);
  expect(artifact).toMatch(/\[token:[a-f0-9]{12}\]/);
}, 10_000);

it('recognizes JSON-protected JWT syntax without mistaking Java package names for credentials', () => {
  const jwt = 'e30.eyJzdWIiOiJzIn0.x';
  expect(redactLogs(jwt, []).leaked).toBe(true);
  expect(redactLogs(jwt, []).text.includes(jwt)).toBe(false);
  expect(redactLogs('org.keycloak.exportimport.dir.DirImportProvider', [])).toEqual({
    text: 'org.keycloak.exportimport.dir.DirImportProvider',
    leaked: false,
  });
});

it('reassembles split UTF-8 bytes before checking later-registered opaque credentials', () => {
  using directory = mkdtempDisposableSync(join(tmpdir(), 'jwt-utf8-logs-'));
  const tokens: string[] = [];
  const logs = privateLogs(tokens);
  const token = 'opaque-🔑-credential';
  const bytes = Buffer.from(token);
  logs.capture(bytes.subarray(0, 9));
  logs.capture(bytes.subarray(9));
  tokens.push(token);
  const path = join(directory.path, 'server.log');
  expect(() => logs.finish(path)).toThrow('Server log contains a credential');
  expect(readFileSync(path, 'utf8')).toMatch(/^\[token:[a-f0-9]{12}\]$/);
});
