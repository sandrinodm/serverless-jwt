/// <reference types="next" />
/// <reference lib="es2024" />

import type * as SharpCJS from 'sharp' with { 'resolution-mode': 'require' };
import type { SharpConstructor as SharpESM } from 'sharp';
import type { SatoriOptions as SatoriBridge } from 'next/dist/compiled/@vercel/og/satori';
import type { SatoriOptions as SatoriOriginal } from 'next/dist/compiled/@vercel/og/satori/index.js';
import type { AppRouteHandlerFn } from 'next/dist/server/route-modules/app-route/module.js';
import type { NextProxy, NextRequest } from 'next/server.js';

import { createProxyGuard, withJwt } from '@serverless-jwt/next';

const route: AppRouteHandlerFn = withJwt({
  issuer: 'https://issuer.example', audience: 'https://api.example',
  mapClaims: (claims) => ({ subject: claims.sub }),
}, (request: NextRequest, context: Parameters<AppRouteHandlerFn>[1], auth) => {
  const subject: unknown = auth.identity.subject;
  const params: Promise<Record<string, string | string[] | undefined>> | undefined = context.params;
  return Response.json({ subject, params, url: request.nextUrl.pathname });
});
const proxy: NextProxy = createProxyGuard({ issuer: 'https://issuer.example', audience: 'api' });
withJwt({ issuer: 'https://issuer.example', audience: 'api', mode: 'optional' }, (_r, _c, auth) => Response.json({ absent: auth === null }));
withJwt({ issuer: 'https://issuer.example', audience: 'api', skip: (request) => request.method === 'OPTIONS' }, (_r, _c, auth) => Response.json({ skipped: auth === undefined }));
void [route, proxy];

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type NotAny<T> = 0 extends (1 & T) ? false : true;
export type SharpExact = Assert<Equal<SharpCJS.SharpConstructor, SharpESM>>;
export type SatoriExact = Assert<Equal<SatoriBridge, SatoriOriginal>>;
export type SharpNotAny = Assert<NotAny<SharpCJS.SharpConstructor>>;
export type SatoriNotAny = Assert<NotAny<SatoriBridge>>;
declare const sharp: SharpCJS.SharpConstructor;
// @ts-expect-error Real Sharp rejects boolean constructor input.
sharp(true);
// @ts-expect-error Real Sharp rejects invented members.
sharp.notAnActualSharpMember;
// @ts-expect-error Real NextRequest has members absent from plain Web Request.
withJwt({ issuer: 'https://issuer.example', audience: 'api' }, () => Response.json({}))(new Request('https://resource.example'), { params: Promise.resolve({}) });
