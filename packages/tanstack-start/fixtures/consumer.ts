/// <reference types="node" />

import type {Auth} from '@serverless-jwt/jwt-verifier';
import type {createMiddleware as SolidFactory} from '@tanstack/solid-start';
import {createMiddleware as reactMiddleware} from '@tanstack/react-start';
import {createMiddleware} from '@tanstack/start-client-core';
import {jwtMiddleware,jwtFunctionMiddleware} from '@serverless-jwt/tanstack-start';

const solidCompatible:typeof SolidFactory=createMiddleware;
const reactCompatible:typeof reactMiddleware=createMiddleware;
const first=createMiddleware({type:'request'}).server(jwtMiddleware({issuer:'https://issuer.example',audience:'api',mapClaims:()=>({subject:'one'})}));
const second=reactCompatible({type:'request'}).middleware([first]).server(({context,next})=>next({context:{subject:context.auth.identity.subject}}));
solidCompatible({type:'request'}).middleware([second]).server(({context,next})=>{
 const auth:Auth<{subject:string}>=context.auth;
 const subject:string=context.subject;
 // @ts-expect-error identity is preserved two middleware levels down
 const wrong:number=context.auth.identity.subject;
 void [auth,subject,wrong];return next();
});
const fn=createMiddleware({type:'function'}).server(jwtFunctionMiddleware({issuer:'https://issuer.example',audience:'api',mapClaims:()=>({account:1})}));
const afterFn=reactCompatible({type:'function'}).middleware([fn]).server(({context,next})=>next({context:{account:context.auth.identity.account}}));
solidCompatible({type:'function'}).middleware([afterFn]).server(({context,next})=>{
 const account:number=context.auth.identity.account;
 // @ts-expect-error independent identity types are not merged globally
 const subject:string=context.auth.identity.subject;
 void [account,subject];return next();
});
const optional=createMiddleware({type:'function'}).server(jwtFunctionMiddleware({issuer:'https://issuer.example',audience:'api',mode:'optional'}));
createMiddleware({type:'function'}).middleware([optional]).server(({context,next})=>{
 const auth:Auth<Readonly<Record<string,unknown>>>|null=context.auth;
 // @ts-expect-error optional missing auth cannot promise a required identity
 const invalid:Auth<Readonly<Record<string,unknown>>>=context.auth;
 void [auth,invalid];return next();
});
const skipped=createMiddleware({type:'request'}).server(jwtMiddleware({issuer:'https://issuer.example',audience:'api',skip:request=>request.method==='OPTIONS'}));
createMiddleware({type:'request'}).middleware([skipped]).server(({context,next})=>{
 const auth:Auth<Readonly<Record<string,unknown>>>|undefined=context.auth;
 // @ts-expect-error deliberate skips cannot promise authentication
 const invalid:Auth<Readonly<Record<string,unknown>>>=context.auth;
 void [auth,invalid];return next();
});
