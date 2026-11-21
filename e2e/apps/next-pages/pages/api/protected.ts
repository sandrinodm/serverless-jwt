import type { NextApiRequest, NextApiResponse } from 'next';

import { withJwtPages } from '@serverless-jwt/next/pages';

import { nodeCors, nodeStream } from '../../capabilities.ts';
import { options } from '../../src/options.ts';
/**
 * Pages owns the original Node request and response; authentication stays an explicit argument.
 */
const handler: (request: NextApiRequest, response: NextApiResponse) => Promise<void> = withJwtPages(
  options,
  async (request, response, auth): Promise<void> => {
    if (!nodeStream(request, response, auth.claims.sub)) {
      response.json({ sub: auth.claims.sub, scopes: auth.scopes });
    }
  },
);

/**
 * Application CORS leaves the original Pages objects untouched before invoking authentication.
 */
const composed: typeof handler = async (request, response) => {
  if (!nodeCors(request, response)) {
    await handler(request, response);
  }
};
export default composed;
