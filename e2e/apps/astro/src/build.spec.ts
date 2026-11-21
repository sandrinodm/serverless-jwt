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
 * Actual production builds cover both emitted artifact detection and routes absent from output
 * arrays.
 */
const cases = [
  'valid',
  'static',
  'dynamic',
  'rest',
  'omitted',
  'mismatch',
  'base',
  'base-static',
  'encoded-base',
  'unicode',
  'redirect',
  'emitted-asset',
  'predicate',
] as const;

for (const name of cases) {
  it('checks real Astro production protection: ' + name, () => {
    using temporary = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-astro-build-'));
    const app = resolve(import.meta.dirname, '..');
    const site = temporary.path;
    cpSync(resolve(app, 'src'), join(site, 'src'), { recursive: true });
    cpSync(resolve(app, 'package.json'), join(site, 'package.json'));
    const project = JSON.parse(readFileSync(resolve(app, 'tsconfig.json'), 'utf8')) as {
      extends: string;
    };
    project.extends = resolve(app, project.extends);
    writeFileSync(join(site, 'tsconfig.json'), JSON.stringify(project));
    mkdirSync(join(site, 'node_modules'));
    for (const entry of readdirSync(resolve(app, 'node_modules'))) {
      symlinkSync(resolve(app, 'node_modules', entry), join(site, 'node_modules', entry), 'dir');
    }

    const base = name === 'encoded-base' ? '/b%61se' : name.startsWith('base') ? '/base' : '';
    const policyBase = name === 'encoded-base' ? '/base' : base;
    const patterns = name === 'unicode' ? ['/api/**', '/café/**'] : [policyBase + '/api/**'];
    writeFileSync(
      join(site, 'src/protect.ts'),
      'export const protect = Object.freeze(' + JSON.stringify(patterns) + ');\n',
    );
    const endpoint = join(site, 'src/pages/api/me.ts');
    if (['static', 'base-static', 'encoded-base'].includes(name)) {
      writeFileSync(
        endpoint,
        readFileSync(endpoint, 'utf8').replace(
          'prerender = false as const',
          'prerender = true as const',
        ),
      );
    }

    if (['dynamic', 'rest', 'unicode', 'redirect'].includes(name)) {
      const route =
        name === 'dynamic'
          ? 'api/[id].ts'
          : name === 'rest'
            ? 'api/[...rest].ts'
            : name === 'unicode'
              ? 'café/private.ts'
              : 'api/redirect.ts';
      mkdirSync(resolve(site, 'src/pages', route, '..'), { recursive: true });
      writeFileSync(
        resolve(site, 'src/pages', route),
        "export const prerender=true; export const getStaticPaths=()=>[{params:{id:'one',rest:'one'}}]; export function GET(context) { " +
          (name === 'redirect'
            ? "return context.redirect('/');"
            : 'return Response.json({private:true});') +
          ' }',
      );
    }

    if (name === 'redirect') {
      const hook = join(site, 'src/middleware.ts');
      writeFileSync(
        hook,
        readFileSync(hook, 'utf8').replace('jwtMiddleware({', 'jwtMiddleware({ skip:()=>true,'),
      );
    }

    if (name === 'predicate') {
      const hook = join(site, 'src/middleware.ts');
      writeFileSync(
        hook,
        readFileSync(hook, 'utf8').replace(
          '    protect,',
          "    protect: context=>context.url.pathname.startsWith('/api/'),",
        ),
      );
    }

    const registration =
      name === 'predicate'
        ? "'predicate'"
        : JSON.stringify(name === 'mismatch' ? ['/other/**'] : patterns);
    writeFileSync(
      join(site, 'astro.config.mjs'),
      `
      import {defineConfig} from 'astro/config'; import node from '@astrojs/node'; import {serverlessJwt} from '@serverless-jwt/astro/build'; import {mkdirSync,writeFileSync} from 'node:fs';
      const metadata={name:'native-metadata',hooks:{'astro:routes:resolved'({routes}){writeFileSync('routes.json',JSON.stringify(routes.map(r=>({pathname:r.pathname,pattern:r.pattern,prerendered:r.isPrerendered,segments:r.segments}))))},'astro:build:done'({pages,assets}){writeFileSync('assets.json',JSON.stringify({pages,assets:[...assets]}))}}};
      const emitted={name:'emitted-protected-asset',hooks:{'astro:build:done'({dir,assets}){const target=new URL('api/static-secret.json',dir);mkdirSync(new URL('api/',dir),{recursive:true});writeFileSync(target,'synthetic-private');const files=assets.get('/');if(!files)throw new Error('Missing native public asset list');files.push(target);}}};
      const guard=serverlessJwt({protect:${registration}}); const checked={...guard,hooks:{...guard.hooks,'astro:build:done':async(data)=>{try{await guard.hooks['astro:build:done'](data);}catch(error){writeFileSync('guard-failure.json',JSON.stringify({name:error.name,reason:error.reason}));throw error;}}}};
      export default defineConfig({output:'server',base:${JSON.stringify(base || '/')},adapter:node({mode:'standalone'}),integrations:[${name === 'emitted-asset' ? 'emitted,' : ''}metadata,${name === 'omitted' ? '' : 'checked'}]});
    `,
    );
    const result = spawnSync(
      process.execPath,
      [resolve(app, 'node_modules/astro/bin/astro.mjs'), 'build'],
      {
        cwd: site,
        encoding: 'utf8',
        timeout: 4500,
        env: {
          PATH: process.env.PATH ?? '',
          NODE_ENV: 'production',
          ASTRO_TELEMETRY_DISABLED: '1',
        },
      },
    );
    const log = (result.stdout ?? '') + (result.stderr ?? '');
    mkdirSync('reports/e2e', { recursive: true });
    writeFileSync('reports/e2e/astro-build-' + name + '.log', log);
    for (const file of ['routes.json', 'assets.json', 'guard-failure.json']) {
      if (existsSync(join(site, file))) {
        cpSync(join(site, file), 'reports/e2e/astro-build-' + name + '-' + file);
      }
    }

    expect(result.error).toBeUndefined();
    const success = ['valid', 'base', 'predicate'].includes(name);
    expect(result.status, log).toBe(success ? 0 : 1);
    if (!success && name !== 'omitted' && name !== 'mismatch') {
      const failure = JSON.parse(readFileSync(join(site, 'guard-failure.json'), 'utf8')) as {
        reason: string;
      };
      assert.match(
        failure.reason,
        /^Protected Astro routes must not be prerendered$|^Cannot prove prerendered Astro route is outside protected subtrees$|^Protected or unsupported Astro route must not be prerendered$/u,
      );
    }

    if (name === 'omitted' || name === 'mismatch') {
      assert.match(log, /assertRegistration/u);
    }

    if (success) {
      assert.equal(existsSync(join(site, 'dist/client/api')), false);
      assert.ok(existsSync(join(site, 'dist/client/index.html')));
    }
  });
}
