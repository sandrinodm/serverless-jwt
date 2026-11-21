import { getAuth } from '@serverless-jwt/nuxt';
import { defineEventHandler, getRequestURL, getHeader } from 'h3';

import { capabilityResponse } from '../../capabilities.ts';
export default defineEventHandler((event) =>
  capabilityResponse(
    {
      url: getRequestURL(event).href,
      method: event.method,
      headers: { get: (name: string): string | null => getHeader(event, name) ?? null },
    },
    getAuth(event).claims.sub,
    Response.json({ sub: getAuth(event).claims.sub, scopes: getAuth(event).scopes }),
  ),
);
