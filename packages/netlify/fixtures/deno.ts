import { withJwt } from '@serverless-jwt/netlify/edge';

const route = withJwt({ issuer: 'https://issuer.example', audience: 'api', mapClaims: () => ({ subject: 'one' }) }, (request, context, auth) => {
  const identity: { subject: string } = auth.identity;
  // @ts-expect-error mapped identity must retain its actual properties
  auth.identity.nonexistent;
  // @ts-expect-error platform context must retain its actual shape
  context.nonexistent;
  // @ts-expect-error native Request must retain its actual shape
  request.nonexistent;
  return Response.json({ sub: identity.subject, requestId: context.requestId });
});
export default route;
