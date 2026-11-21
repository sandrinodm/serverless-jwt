import assert from 'node:assert/strict';
import { parseSync } from 'vite-plus';

/**
 * Rejects executable references to TypeScript source without mistaking comments or text for code.
 */
export function assertJavaScriptImports(code, filename) {
  const parsed = parseSync(filename, code);
  assert.equal(parsed.errors.length, 0, `Invalid JavaScript in ${filename}`);

  /**
   * Visits import expressions at any depth, including lazy functions that smoke imports never call.
   */
  const visit = (node) => {
    if (!node || typeof node !== 'object') {
      return;
    }

    if (
      [
        'ImportDeclaration',
        'ExportNamedDeclaration',
        'ExportAllDeclaration',
        'ImportExpression',
      ].includes(node.type)
    ) {
      const source = node.source;
      const specifier =
        source?.type === 'TemplateLiteral' && source.expressions.length === 0
          ? source.quasis[0].value.cooked
          : source?.value;
      if (typeof specifier === 'string') {
        assert.doesNotMatch(
          specifier,
          /\.[cm]?tsx?(?:[?#]|$)/i,
          `TypeScript import in ${filename}: ${specifier}`,
        );
      }
    }

    for (const child of Object.values(node)) {
      if (Array.isArray(child)) {
        child.forEach(visit);
      } else {
        visit(child);
      }
    }
  };
  visit(parsed.program);
}
