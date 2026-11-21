# Scopes and claims

[README](../README.md) · [Getting started](getting-started.md) · [Configuration](configuration.md) · [Errors](errors.md) · [Providers](providers/README.md)

## Signed claims and application identity

A successful verification returns `Auth`: `claims` is the immutable verified payload, `identity` is your mapper's separate object, `scopes` is the frozen signed scope set, and `token` is the original credential for delegation. Do not log the entire object.

```ts
import { createJwtVerifier, requireScopes } from '@serverless-jwt/jwt-verifier';

const verifier = createJwtVerifier({
  issuer: 'https://issuer.example.com/',
  audience: 'https://api.example.com',
  mapClaims: (claims) => ({ userId: claims.sub, displayName: claims.name }),
});
const auth = await verifier.verify(accessToken);
requireScopes(auth, ['read:orders']);
```

Mapping receives deeply frozen claims. It must return an object, synchronously or asynchronously; thrown/rejected values, invalid output and timeouts cannot bypass verification. Its output never replaces signed claims or supplies new signed scopes. The application owns any additional identity-object immutability it needs.

## Scope checks

`scope` takes precedence over `scp` when both exist, with a diagnostic. OAuth `scope` must be a string. `scp` may be a string or string array. Scopes split on ASCII spaces; invalid scope tokens are filtered with a diagnostic, and duplicates are removed. Malformed scope shapes yield an empty scope set rather than invented permissions.

```ts
import { hasScopes, requireScopes } from '@serverless-jwt/jwt-verifier';

const canRead = hasScopes(auth, ['read:orders']);
requireScopes(auth, ['read:orders', 'admin:orders'], 'any');
```

Default mode is `all`; `any` requires at least one configured scope. Required scopes must be a nonempty array of valid strings. `requireScopes` throws the fixed insufficient-scope error (403). Authentication does not replace resource-level authorization: check tenant ownership and object permissions in application code.

## Helper semantics and namespace collisions

```ts
import { claimToArray, removeNamespaces } from '@serverless-jwt/jwt-verifier';

claimToArray('read:orders write:orders'); // ['read:orders', 'write:orders']
claimToArray(['reader']); // ['reader']
claimToArray(42); // []
const mapped = removeNamespaces(auth.claims, 'https://claims.example.com/');
```

`claimToArray` converts strings or all-string arrays; it does not coerce arbitrary values or validate scopes. Namespace removal strips only a leading namespace, returns a frozen null-prototype object, and throws `ConfigurationError` on collisions in either input order. For example, both `role` and `https://claims.example.com/role` cannot map to `role`. Pollution names are discarded.
