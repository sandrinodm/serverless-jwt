/// <reference types="node" />
/// <reference types="astro/client" />

import type { Auth } from '@serverless-jwt/jwt-verifier';
import type { AstroIntegration, MiddlewareHandler } from 'astro';

import { jwtMiddleware, requireAuth } from '@serverless-jwt/astro';
import { serverlessJwt } from '@serverless-jwt/astro/build';
import { repairAstroTypes } from '@serverless-jwt/astro/type-repair';
import type { AstroTypeRepairOptions, AstroTypeRepairResult } from '@serverless-jwt/astro/type-repair';
const repair: (options?: AstroTypeRepairOptions) => AstroTypeRepairResult = repairAstroTypes;

const middleware: MiddlewareHandler = jwtMiddleware({issuer:'https://issuer.example',audience:'api',protect:['/api/**'],mode:'optional',skip:()=>false,mapClaims:()=>({subject:'one'})});
const checked:Auth<{subject:string}>=requireAuth<{subject:string}>({});
const honest:Auth<unknown>|null|undefined=({} as App.Locals).auth;
// @ts-expect-error shared locals cannot promise one factory's identity
const invalid:Auth<{subject:string}>=honest;
// @ts-expect-error protect is mandatory
jwtMiddleware({issuer:'https://issuer.example',audience:'api'});
const integration:AstroIntegration=serverlessJwt({protect:['/api/**']});
void [middleware,checked,invalid,integration,repair];
