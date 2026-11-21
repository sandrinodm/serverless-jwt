import { startIssuer } from '../../../packages/testkit/src/issuer.ts';
import { fixtureKey } from '../../../packages/testkit/src/keys.ts';
import { startOidcIssuer } from './issuer.ts';

/**
 * Starts both verified HTTPS issuers once for the PR contract project and always tears them down.
 */
export default async function setup(project: {
  readonly provide: (
    key: 'e2eUrls',
    value: { readonly oidc: string; readonly hostile: string },
  ) => void;
}): Promise<() => Promise<void>> {
  const oidc = await startOidcIssuer();
  try {
    const key = fixtureKey(2048);
    const hostile = await startIssuer({
      script: (path) => (path === '/outage' ? { status: 503 } : { json: { keys: [key.jwk] } }),
    });
    project.provide('e2eUrls', { oidc: oidc.url, hostile: hostile.url });
    return async (): Promise<void> => {
      try {
        await hostile.close();
      } finally {
        await oidc.close();
      }
    };
  } catch (cause) {
    await oidc.close();
    throw cause;
  }
}
