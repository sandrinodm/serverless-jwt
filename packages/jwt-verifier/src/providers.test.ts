import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { expect, test } from 'vite-plus/test';

import type { JwtVerifier } from './verify.ts';

import { createJwtVerifier } from './verify.ts';

const pair = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'provider-fixtures' };
const now = 1_800_000_000;
const cases = [
  {
    name: 'Auth0',
    issuer: 'https://tenant.auth0.com/',
    audience: 'https://api.example.com',
    profile: 'rfc9068',
    typ: 'at+jwt',
    access: {
      client_id: 'oauth-client',
      jti: 'access-id',
      scope: 'read:orders',
    },
    id: {
      aud: 'oauth-client',
      nonce: 'id-nonce',
    },
  },
  {
    name: 'Okta',
    issuer: 'https://example.okta.com/oauth2/default',
    audience: 'api://orders',
    profile: 'generic',
    typ: 'JWT',
    access: {
      cid: 'oauth-client',
      scp: ['read:orders'],
    },
    id: {
      aud: 'oauth-client',
      nonce: 'id-nonce',
    },
  },
  {
    name: 'Microsoft Entra ID',
    issuer: 'https://login.microsoftonline.com/11111111-1111-1111-1111-111111111111/v2.0',
    audience: '22222222-2222-2222-2222-222222222222',
    profile: 'generic',
    typ: 'JWT',
    access: {
      azp: '33333333-3333-3333-3333-333333333333',
      ver: '2.0',
      scp: 'read:orders',
    },
    id: {
      aud: '33333333-3333-3333-3333-333333333333',
      ver: '2.0',
      nonce: 'id-nonce',
    },
  },
  {
    name: 'Amazon Cognito',
    issuer: 'https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_example',
    audience: 'https://api.example.com',
    profile: 'generic',
    typ: 'JWT',
    access: {
      client_id: 'oauth-client',
      token_use: 'access',
      scope: 'read:orders',
    },
    id: {
      aud: 'oauth-client',
      token_use: 'id',
      nonce: 'id-nonce',
    },
  },
  {
    name: 'Keycloak',
    issuer: 'https://sso.example.com/realms/example',
    audience: 'orders-api',
    profile: 'generic',
    typ: 'JWT',
    access: {
      azp: 'oauth-client',
      scope: 'read:orders',
      typ: 'Bearer',
    },
    id: {
      aud: 'oauth-client',
      typ: 'ID',
      nonce: 'id-nonce',
    },
  },
  {
    name: 'Clerk',
    issuer: 'https://example.clerk.accounts.dev',
    audience: 'https://api.example.com',
    profile: 'generic',
    typ: 'JWT',
    access: {
      client_id: 'oauth-client',
      scope: 'read:orders',
      jti: 'access-id',
    },
    id: {
      aud: 'oauth-client',
      nonce: 'id-nonce',
      jti: 'id-token-id',
    },
  },
  {
    name: 'WorkOS',
    issuer: 'https://auth.example.com',
    audience: 'https://api.example.com',
    profile: 'generic',
    typ: 'JWT',
    access: {
      client_id: 'oauth-client',
      scope: 'read:orders',
      jti: 'access-id',
    },
    id: {
      aud: 'oauth-client',
      nonce: 'id-nonce',
    },
  },
] as const;

/**
 * Signs both token products with the same valid key; no invalid-signature shortcuts.
 */
async function mint(
  issuer: string,
  audience: string | ReadonlyArray<string>,
  claims: Readonly<Record<string, unknown>>,
  typ = 'JWT',
): Promise<string> {
  return new SignJWT({
    iss: issuer,
    aud: typeof audience === 'string' ? audience : [...audience],
    sub: 'user-123',
    iat: now,
    exp: now + 300,
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid, typ })
    .sign(pair.privateKey);
}

/**
 * Builds the documented trust policy against the shared synthetic signing key.
 */
function verifierFor(provider: (typeof cases)[number]): JwtVerifier {
  return createJwtVerifier({
    issuer: provider.issuer,
    audience: provider.audience,
    profile: provider.profile,
    algorithms: ['RS256'],
    jwksUri: `${provider.issuer.replace(/\/$/, '')}/jwks`,
    clock: { now: (): number => now * 1000 },
    fetch: async (): Promise<Response> => Response.json({ keys: [jwk] }),
  });
}

for (const provider of cases) {
  test(`${provider.name}: configured access token passes and same-key ID token fails`, async () => {
    const verifier = verifierFor(provider);
    const access = await mint(provider.issuer, provider.audience, provider.access, provider.typ);
    expect((await verifier.verify(access)).claims.aud).toBe(provider.audience);
    const id = await mint(provider.issuer, provider.id.aud, provider.id);
    await expect(verifier.verify(id)).rejects.toMatchObject({
      reason: provider.profile === 'rfc9068' ? 'claim_type' : 'claim_audience',
    });
  });
}

test('ZITADEL shared project audience cannot distinguish native ID tokens under generic policy', async () => {
  const issuer = 'https://identity.example.com';
  const audience = ['project-id', 'oauth-client', 'other-project-client'];
  const verifier = createJwtVerifier({
    issuer,
    audience: 'project-id',
    jwksUri: `${issuer}/oauth/v2/keys`,
    algorithms: ['RS256'],
    clock: { now: (): number => now * 1000 },
    fetch: async (): Promise<Response> => Response.json({ keys: [jwk] }),
  });
  const access = await mint(issuer, audience, {
    azp: 'oauth-client',
    jti: 'access-id',
    nbf: now,
    scope: 'openid read:orders',
  });
  const id = await mint(issuer, audience, {
    azp: 'oauth-client',
    nonce: 'id-nonce',
    auth_time: now,
    amr: ['pwd'],
  });
  expect((await verifier.verify(access)).claims.aud).toEqual(audience);
  expect((await verifier.verify(id)).claims.aud).toEqual(audience);
});

test('Auth0 RFC profile rejects same-audience ID typ even with all access claims present', async () => {
  const provider = cases[0];
  const token = await mint(provider.issuer, provider.audience, {
    ...provider.access,
    nonce: 'id-nonce',
  });
  await expect(verifierFor(provider).verify(token)).rejects.toMatchObject({ reason: 'claim_type' });
});

test('Cognito ordinary audience-less access token remains unsupported', async () => {
  const provider = cases[3];
  const token = await mint(provider.issuer, provider.audience, {
    ...provider.access,
    aud: undefined,
  });
  await expect(verifierFor(provider).verify(token)).rejects.toMatchObject({
    reason: 'claim_missing',
  });
});
