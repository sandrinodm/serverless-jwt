import { expect, test } from 'vite-plus/test';

import { assertJavaScriptImports } from './package-imports.mjs';

test.each([
  `export const lazy = () => import( "./missing.ts");`,
  `import /* comment */ './missing.mts';`,
  `export { value } from './missing.cts';`,
  `export * from './missing.tsx';`,
  'export const lazy = () => import(`./missing.mtsx`);',
  `export const lazy = () => import('./missing.\\u0074s?raw');`,
])('rejects an executable TypeScript import: %s', (code) => {
  expect(() => assertJavaScriptImports(code, 'package/dist/index.mjs')).toThrow(
    'TypeScript import',
  );
});

test('accepts JavaScript imports, comments and arbitrary strings', () => {
  expect(() =>
    assertJavaScriptImports(
      `import './side.mjs'; export * from './other.js';
       export const lazy = () => import( './lazy.cjs');
       // import './comment.ts';
       const example = "import('./string.ts')";`,
      'package/dist/index.mjs',
    ),
  ).not.toThrow();
});
