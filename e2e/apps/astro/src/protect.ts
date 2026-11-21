/**
 * One immutable deployment-path policy binds runtime authentication to production checks.
 */
export const protect: ReadonlyArray<string> = Object.freeze(['/api/**']);
