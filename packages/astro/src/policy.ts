import type { RegisteredPolicy } from './protection.ts';

/**
 * Ordinary Node imports are safe, but no handle can be constructed without the build bridge.
 */
export const registeredPolicy: RegisteredPolicy = Object.freeze({ kind: 'unregistered' });
