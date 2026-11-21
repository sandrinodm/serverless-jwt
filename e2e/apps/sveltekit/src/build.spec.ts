import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempDisposableSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vite-plus/test';

/**
 * Each actual production build owns its source, native generated types, output and logs.
 */
const cases = [
  'valid',
  'static',
  'auto',
  'dynamic-entries',
  'dynamic-empty',
  'optional',
  'rest',
  'group',
  'escape',
  'redirect',
  'omitted',
  'mismatch',
  'base',
  'base-static',
  'encoded-base-static',
  'unicode',
  'omitted-runtime',
] as const;

for (const name of cases) {
  it('checks real SvelteKit production prerender policy: ' + name, () => {
    using temporary = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-sveltekit-build-'));
    const app = resolve(import.meta.dirname, '..');
    const site = temporary.path;
    cpSync(resolve(app, 'src'), join(site, 'src'), { recursive: true });
    cpSync(resolve(app, 'package.json'), join(site, 'package.json'));
    const project = JSON.parse(readFileSync(resolve(app, 'tsconfig.types.json'), 'utf8')) as {
      extends: string[];
    };
    project.extends = project.extends.map((entry) =>
      entry.startsWith('.') ? resolve(app, entry) : entry,
    );
    writeFileSync(join(site, 'tsconfig.types.json'), JSON.stringify(project));
    mkdirSync(join(site, 'node_modules'));
    for (const entry of readdirSync(resolve(app, 'node_modules'))) {
      if (entry !== '$app') {
        symlinkSync(resolve(app, 'node_modules', entry), join(site, 'node_modules', entry), 'dir');
      }
    }

    const base =
      name === 'encoded-base-static' ? '/b%61se' : name.startsWith('base') ? '/base' : '';
    const policyBase = name === 'encoded-base-static' ? '/base' : base;
    const patterns = name === 'unicode' ? ['/api/**', '/café/**'] : [policyBase + '/api/**'];
    writeFileSync(
      join(site, 'src/protect.ts'),
      'export const protect = Object.freeze(' + JSON.stringify(patterns) + ');\n',
    );
    const endpoint = join(site, 'src/routes/api/me/+server.ts');
    if (
      name === 'static' ||
      name === 'auto' ||
      name === 'base-static' ||
      name === 'encoded-base-static'
    ) {
      writeFileSync(
        endpoint,
        readFileSync(endpoint, 'utf8').replace(
          'prerender: boolean = false',
          "prerender: boolean | 'auto' = " + (name === 'auto' ? "'auto'" : 'true'),
        ),
      );
    }

    if (
      [
        'dynamic-entries',
        'dynamic-empty',
        'optional',
        'rest',
        'group',
        'escape',
        'redirect',
        'unicode',
      ].includes(name)
    ) {
      const route =
        name === 'optional'
          ? 'api/[[optional]]'
          : name === 'rest'
            ? 'api/[...rest]'
            : name === 'group'
              ? '(group)/api/group'
              : name === 'escape'
                ? 'api/[x+65]scaped'
                : name === 'redirect'
                  ? 'api/redirect'
                  : name === 'unicode'
                    ? 'café/private'
                    : 'api/[id]';
      mkdirSync(join(site, 'src/routes', route), { recursive: true });
      const handler =
        name === 'redirect'
          ? "import { redirect } from '@sveltejs/kit'; export function GET() { redirect(308, '/public'); }"
          : 'export function GET() { return Response.json({ private: true }); }';
      writeFileSync(
        join(site, 'src/routes', route, '+server.ts'),
        'export const prerender = true;\n' +
          handler +
          (name === 'dynamic-entries' ? "\nexport const entries = () => [{ id: 'one' }];" : ''),
      );
      if (name === 'redirect') {
        const hook = join(site, 'src/hooks.server.ts');
        writeFileSync(
          hook,
          readFileSync(hook, 'utf8').replace('jwtHandle({', 'jwtHandle({ skip: () => true,'),
        );
      }
    }

    if (name === 'omitted-runtime') {
      const publicRoute = join(site, 'src/routes/public/+server.ts');
      writeFileSync(
        publicRoute,
        readFileSync(publicRoute, 'utf8').replace(
          'prerender: boolean = true',
          'prerender: boolean = false',
        ),
      );
    }

    const omitted = name === 'omitted' || name === 'omitted-runtime';
    const registered = name === 'mismatch' ? ['/different/**'] : patterns;
    writeFileSync(
      join(site, 'vite.app.config.ts'),
      `
      import { defineConfig } from 'vite-plus';
      import { sveltekit } from '@sveltejs/kit/vite';
      import node from '@sveltejs/adapter-node';
      import { serverlessJwtAdapter } from '@serverless-jwt/sveltekit/build';
      import { writeFileSync } from 'node:fs';
      const inner = node();
      const composed = { ...inner, async adapt(builder) { writeFileSync('inner-adapt.txt', 'called'); return inner.adapt(builder); } };
      const checked = ${omitted ? 'composed' : 'serverlessJwtAdapter(composed, { protect: ' + JSON.stringify(registered) + ' })'};
      const reported = { ...checked, async adapt(builder) { writeFileSync('builder.json', JSON.stringify({ paths:builder.prerendered.paths, routes:builder.routes.map(({id,prerender,segments})=>({id,prerender,segments})) })); return checked.adapt(builder); } };
      export default defineConfig({ plugins: [sveltekit({ adapter: reported, paths: { base: ${JSON.stringify(base)} }, prerender: { handleHttpError:'ignore', handleUnseenRoutes:'ignore' } })] });
    `,
    );
    const result = spawnSync(
      resolve(app, 'node_modules/.bin/vp'),
      ['build', '--config', 'vite.app.config.ts'],
      { cwd: site, encoding: 'utf8', timeout: 4500 },
    );
    const log = (result.stdout ?? '') + (result.stderr ?? '');
    mkdirSync('reports/e2e', { recursive: true });
    writeFileSync('reports/e2e/sveltekit-build-' + name + '.log', log);
    if (existsSync(join(site, 'builder.json'))) {
      cpSync(join(site, 'builder.json'), 'reports/e2e/sveltekit-build-' + name + '.json');
    }

    expect(result.error).toBeUndefined();
    const success = ['valid', 'base', 'omitted-runtime'].includes(name);
    expect(result.status, log).toBe(success ? 0 : 1);
    expect(existsSync(join(site, 'inner-adapt.txt'))).toBe(success);
    if (name === 'valid' || name === 'base') {
      assert.ok(
        existsSync(join(site, 'build/prerendered', base ? 'base/public.html' : 'public.html')),
      );
      assert.equal(existsSync(join(site, 'build/prerendered/api')), false);
    }

    if (name === 'omitted-runtime') {
      const script =
        "import {createServer} from 'node:http'; import {handler} from './build/handler.js'; const server=createServer(handler); await new Promise(r=>server.listen(0,'127.0.0.1',r)); try { const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/me'); if(response.status!==500) throw new Error('Unregistered hook did not fail closed'); } finally { server.closeAllConnections(); await new Promise(r=>server.close(r)); }";
      const startup = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
        cwd: site,
        encoding: 'utf8',
        timeout: 1500,
        env: {
          NODE_ENV: 'production',
          PATH: process.env.PATH ?? '',
          ORIGIN: 'http://localhost',
          ISSUER: 'https://issuer.example',
        },
      });
      assert.ifError(startup.error);
      assert.equal(startup.status, 1);
      assert.match(startup.stderr, /SvelteKit JWT policy registration is missing or mismatched/);
    }
  });
}
