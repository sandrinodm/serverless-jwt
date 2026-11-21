import type {Auth} from '@serverless-jwt/jwt-verifier';
import type {MiddlewareFunction} from 'react-router';
import {RouterContextProvider} from 'react-router';
import {createAuthContext,jwtMiddleware} from '@serverless-jwt/react-router';

const first=createAuthContext<{subject:string}>();
const second=createAuthContext<{account:number}>();
const provider=new RouterContextProvider();
const mapped:MiddlewareFunction<Response>=jwtMiddleware({issuer:'https://issuer.example',audience:'api',context:first,mapClaims:()=>({subject:'one'})});
const optional:MiddlewareFunction<Response>=jwtMiddleware({issuer:'https://issuer.example',audience:'api',context:second,mapClaims:()=>({account:1}),mode:'optional',skip:()=>false});
const identity:Auth<{subject:string}>|null|undefined=provider.get(first);
// @ts-expect-error context is mandatory
jwtMiddleware({issuer:'https://issuer.example',audience:'api'});
jwtMiddleware({issuer:'https://issuer.example',audience:'api',context:first,
// @ts-expect-error mapped identities must agree with the app-owned context
mapClaims:()=>({account:1})});
// @ts-expect-error independently typed context values cannot be exchanged
const wrong:Auth<{subject:string}>|null|undefined=provider.get(second);
void [mapped,optional,identity,wrong];
