import type { Scenario } from './index.ts';

/**
 * Proves last-write collision behavior and prototype replacement with attacker-controlled
 * namespaces.
 */
export const namespaceScenarios: ReadonlyArray<Scenario> = [
  'sub-namespaced-last',
  'sub-namespaced-first',
  'scope',
  'roles',
  '__proto__',
].map((name) => ({
  id: name === '__proto__' ? 'namespaces.__proto__' : `namespaces.collision-${name}`,
  description: `removeNamespaces collision ${name}`,

  owner: 'core',
  issuer: () => ({}),

  expected:
    name === '__proto__'
      ? { outcome: 'accepted', facts: { inheritedAdmin: false } }
      : { outcome: 'rejected', reason: 'namespace_collision' },
  run: async (context) => {
    let facts: Record<string, unknown> | undefined;
    const observed = await context.observe(() => {
      const claims =
        name === '__proto__'
          ? (JSON.parse('{"https://claims/__proto__":{"admin":true}}') as Record<string, unknown>)
          : name === 'sub-namespaced-first'
            ? { 'https://claims/sub': 'attacker', sub: 'plain' }
            : {
                [name === 'scope' || name === 'roles' ? name : 'sub']: 'plain',
                [`https://claims/${name === 'scope' || name === 'roles' ? name : 'sub'}`]:
                  'attacker',
              };
      const result = context.driver.helpers.removeNamespaces('https://claims/', claims);
      facts = {
        inheritedAdmin: result.admin === true,
        prototypeReplaced: Object.getPrototypeOf(result) !== Object.prototype,
      };
      return result;
    });
    return { ...observed, ...(facts ? { facts } : {}) };
  },
}));
