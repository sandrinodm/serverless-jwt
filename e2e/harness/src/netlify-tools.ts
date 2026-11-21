import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, sep } from 'node:path';

/**
 * Exact registry age/integrity evidence for the native CLI API graph, separate from the TS7 app.
 */
const evidence = JSON.parse(
  readFileSync(new URL('../../netlify-tool-layout.json', import.meta.url), 'utf8'),
);

/**
 * Installs only the native CLI in its own ordinary npm graph so broad legacy API peers cannot bind
 * to the application's native-only TS7 compiler package. Public packages remain hoisted.
 */
export function prepareNetlifyTools(
  application: string,
  npm: string,
  overrides: Readonly<Record<string, unknown>>,
  cutoff: string,
): void {
  const tools = join(application, '.e2e-tools/netlify');
  mkdirSync(tools, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(tools, 'package.json'),
    JSON.stringify(
      {
        name: 'serverless-jwt-private-netlify-host',
        private: true,
        type: 'module',
        dependencies: {
          'netlify-cli': evidence.packages['netlify-cli'].version,
          typescript: evidence.packages.typescript.version,
        },
        overrides,
      },
      null,
      2,
    ) + '\n',
  );
  execFileSync(
    process.execPath,
    [npm, 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--before=' + cutoff],
    { cwd: tools, stdio: 'pipe', timeout: 180_000 },
  );
  const lock = JSON.parse(readFileSync(join(tools, 'package-lock.json'), 'utf8')) as {
    readonly packages: Readonly<
      Record<
        string,
        { readonly version?: string; readonly integrity?: string; readonly resolved?: string }
      >
    >;
  };
  for (const [name, record] of Object.entries(evidence.packages) as ReadonlyArray<
    readonly [
      string,
      { readonly version: string; readonly integrity: string; readonly tarball: string },
    ]
  >) {
    const entries = Object.entries(lock.packages).filter(
      ([path]) => path.endsWith('/node_modules/' + name) || path === 'node_modules/' + name,
    );
    assert.ok(entries.length > 0, 'Missing pinned native CLI API dependency');
    for (const [, entry] of entries) {
      assert.equal(entry.version, record.version, 'Native CLI API version drifted');
      assert.equal(entry.integrity, record.integrity, 'Native CLI API integrity drifted');
      assert.equal(entry.resolved, record.tarball, 'Native CLI API registry origin drifted');
    }
  }

  const apiEntry = Object.keys(lock.packages).find((path) => path.endsWith('/ts-api-utils'));
  assert.ok(apiEntry);
  const require = createRequire(join(tools, apiEntry, 'package.json'));
  const peer = realpathSync(require.resolve('typescript/package.json'));
  assert.ok(
    peer.startsWith(realpathSync(tools) + sep),
    'Native CLI API peer escaped its own graph',
  );
  assert.equal(
    JSON.parse(readFileSync(peer, 'utf8')).version,
    evidence.packages.typescript.version,
  );
  assert.equal(
    typeof require('typescript').TypeFlags,
    'object',
    'Native CLI requires its declared JavaScript compiler API',
  );
  const compiler = execFileSync(join(application, 'node_modules/.bin/tsc'), ['--version'], {
    encoding: 'utf8',
    timeout: 10_000,
  }).trim();
  assert.equal(
    compiler,
    'Version ' + evidence.applicationCompiler,
    'Application compiler must remain exact TS7',
  );
  const applicationRequire = createRequire(join(application, 'package.json'));
  const adapterEntry = applicationRequire.resolve('@serverless-jwt/netlify');
  const adapterRequire = createRequire(adapterEntry);
  const rootCore = realpathSync(applicationRequire.resolve('@serverless-jwt/jwt-verifier'));
  const adapterCore = realpathSync(adapterRequire.resolve('@serverless-jwt/jwt-verifier'));
  assert.equal(adapterCore, rootCore, 'Tool isolation must preserve public core instance identity');
  const control = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
    import assert from 'node:assert/strict';
    import { pathToFileURL } from 'node:url';
    const core = await import(pathToFileURL(process.argv[1]).href);
    const adapter = await import(pathToFileURL(process.argv[2]).href);
    const verifier = core.createJwtVerifier({ issuer: 'https://issuer.example', audience: 'api' });
    let handler = false;
    const events = [];
    const wrapped = adapter.withJwt({ verifier, onIntegrationDiagnostic: (event) => events.push(event.type) }, () => { handler = true; return new Response('unexpected'); });
    const response = await wrapped(new Request('https://api.example/protected', { headers: { authorization: 'Bearer invalid' } }), {});
    assert.equal(response.status, 401);
    assert.equal(handler, false);
    assert.deepEqual(events, []);
    process.stdout.write(JSON.stringify({ status: response.status, handler, integrationDiagnostics: events }));
  `,
      rootCore,
      adapterEntry,
    ],
    { cwd: application, encoding: 'utf8', timeout: 10_000 },
  );
  symlinkSync(
    '../.e2e-tools/netlify/node_modules/netlify-cli',
    join(application, 'node_modules/netlify-cli'),
    'dir',
  );
  writeFileSync(
    join(application, '.e2e-netlify-tools.json'),
    JSON.stringify(
      {
        strategy: 'ordinary npm application graph plus separate ordinary npm CLI API graph',
        peer: peer.slice(application.length),
        rootCore: rootCore.slice(application.length),
        adapterCore: adapterCore.slice(application.length),
        rootVerifierControl: JSON.parse(control),
        compiler,
        api: evidence.packages,
      },
      null,
      2,
    ) + '\n',
  );
}
