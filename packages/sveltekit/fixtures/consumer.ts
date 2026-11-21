/// <reference types="node" />
/// <reference path="./node_modules/$app/types/index.d.ts" />

import type { Auth } from '@serverless-jwt/jwt-verifier';
import type { Adapter } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';

import { jwtHandle, requireAuth } from '@serverless-jwt/sveltekit';
import { serverlessJwtAdapter } from '@serverless-jwt/sveltekit/build';

const handle: Handle = jwtHandle({ issuer: 'https://issuer.example', audience: 'api', protect: ['/api/**'], mapClaims: () => ({ subject: 'one' }), mode: 'optional', skip: () => false });
const identity: Auth<{ subject: string }> = requireAuth<{ subject: string }>({});
const unknownAuth: Auth<unknown> | null | undefined = ({} as App.Locals).auth;
// @ts-expect-error globally shared locals do not promise a factory-specific identity
const incorrect: Auth<{ subject: string }> = unknownAuth;
// @ts-expect-error protect is mandatory
jwtHandle({ issuer: 'https://issuer.example', audience: 'api' });
const adapter: Adapter = serverlessJwtAdapter({ name: 'fixture', adapt: () => {} }, { protect: ['/api/**'] });
void [handle, identity, incorrect, adapter];
