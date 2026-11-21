import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempDisposableSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Reads only exact artifact contents so graph checks cannot accidentally inspect workspace sources.
 */
function member(tarball, path) {
  return execFileSync('tar', ['-xOf', tarball, 'package/dist/' + path], { encoding: 'utf8' });
}

/**
 * Traverses actual relative declaration edges, including Next's reviewed declaration companions.
 */
function declarationGraph(tarball, entry) {
  const seen = new Set();
  const pending = [entry];
  let text = '';
  while (pending.length) {
    const path = pending.pop();
    if (seen.has(path)) {
      continue;
    }

    seen.add(path);
    const code = member(tarball, path);
    text += code;
    for (const match of code.matchAll(/from ["']\.\/([^"']+)\.mjs["']/gu)) {
      pending.push(match[1] + '.d.mts');
    }

    for (const match of code.matchAll(/<reference path=["']\.\/([^"']+\.d\.[cm]?ts)["']/gu)) {
      pending.push(match[1]);
    }
  }

  return { seen, text };
}

/**
 * Prevents Pages and incompatible h3 entrypoint declarations from contaminating portable roots.
 */
export function verifyEntryIsolation(tarball, manifest, names) {
  if (manifest.name === '@serverless-jwt/next') {
    assert.ok(names.includes('package/dist/pages.mjs'));
    assert.ok(names.includes('package/dist/pages.d.mts'));
    assert.match(member(tarball, 'pages.d.mts'), /<reference lib=["']es2024\.promise["']/u);
    assert.doesNotMatch(member(tarball, 'index.d.mts'), /<reference lib=["']es2024\.promise["']/u);
    const root = declarationGraph(tarball, 'index.d.mts');
    assert.ok(!root.seen.has('pages.d.mts'));
    assert.doesNotMatch(root.text, /NextApiRequest|NextApiResponse/gu);
    for (const file of names.filter(
      (name) => name.endsWith('.mjs') && !name.endsWith('/pages.mjs'),
    )) {
      const code = execFileSync('tar', ['-xOf', tarball, file], { encoding: 'utf8' });
      assert.doesNotMatch(
        code,
        /(?:from\s*|import\s*\()["'](?:node:|(?:http|https|fs|net|stream|buffer|url|path)(?:["'/]))/gu,
      );
    }
  }

  if (manifest.name === '@serverless-jwt/nuxt') {
    const root = declarationGraph(tarball, 'index.d.mts');
    const v2 = declarationGraph(tarball, 'h3-v2.d.mts');
    assert.ok(!root.seen.has('h3-v2.d.mts'));
    assert.ok(!v2.seen.has('index.d.mts'));
    assert.doesNotMatch(v2.text, /from ["'](?:h3|h3-v2)["']/gu);
  }
}

/**
 * Installs the same packed Nuxt artifact into an independent real h3 v2 consumer under strict
 * types.
 */
export function verifyNuxtV2Consumer(root, tarball, manifest, internal, source, npm, before) {
  using temporary = mkdtempDisposableSync(join(tmpdir(), 'serverless-jwt-h3-v2-consumer-'));
  const cwd = temporary.path;
  writeFileSync(
    join(cwd, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      dependencies: {
        [manifest.name]: 'file:' + tarball,
        ...Object.fromEntries([...internal].map(([name, path]) => [name, 'file:' + path])),
        h3: '2.0.8',
        '@types/node': '26.6.6',
        crossws: manifest.peerDependencies.crossws,
      },
      overrides: Object.fromEntries([...internal].map(([name]) => [name, '$' + name])),
    }),
  );
  execFileSync(
    process.execPath,
    [npm, 'install', '--no-audit', '--no-fund', '--ignore-scripts', '--before=' + before],
    { cwd, stdio: 'inherit', timeout: 180_000 },
  );
  cpSync(join(source, 'fixtures/h3-v2-consumer.ts'), join(cwd, 'consumer.ts'));
  for (const mode of ['nodenext', 'bundler']) {
    writeFileSync(
      join(cwd, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          target: 'ES2023',
          lib: ['ES2023', 'ESNext.Error', 'DOM', 'DOM.Iterable'],
          types: [],
          module: mode === 'nodenext' ? 'nodenext' : 'esnext',
          moduleResolution: mode,
        },
        files: ['consumer.ts'],
      }),
    );
    execFileSync(join(root, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.json'], {
      cwd,
      stdio: 'inherit',
      timeout: 180_000,
    });
  }
}
