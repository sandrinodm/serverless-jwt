# Identity providers

[README](../../README.md) · [Getting started](../getting-started.md) · [Configuration](../configuration.md) · [Providers](README.md)

Choose a guide for the exact token product you issue. Each verified configuration keeps API access tokens separate from ID tokens using a distinct resource audience or an explicitly configured access-token profile. A valid signature alone does not establish token purpose.

| Provider                          | Covered configuration                                                                    | Status                                                  |
| --------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| [Auth0](auth0.md)                 | Auth0 API access tokens with the API explicitly set to the RFC 9068 access-token profile | Synthetic shape checks; hosted issuance unverified      |
| [Okta](okta.md)                   | JWT access tokens from an Okta custom authorization server                               | Synthetic shape checks; hosted issuance unverified      |
| [Microsoft Entra ID](entra-id.md) | v2 JWT access tokens for a separately registered API                                     | Synthetic shape checks; hosted issuance unverified      |
| [Amazon Cognito](cognito.md)      | Resource-bound user-pool JWT access tokens from supported user authorization flows       | Synthetic shape checks; hosted issuance unverified      |
| [Keycloak](keycloak.md)           | JWT access tokens with an access-token-only API audience mapper                          | Synthetic shape checks; hosted issuance unverified      |
| [Clerk](clerk.md)                 | Native OAuth JWT access tokens bound to an MCP/API resource URL                          | Synthetic shape checks; hosted issuance unverified      |
| [WorkOS](workos.md)               | WorkOS Connect user access tokens requested for a distinct API resource                  | Synthetic shape checks; hosted issuance unverified      |
| [ZITADEL](zitadel.md)             | Shared-project-audience native JWTs                                                      | **Unverified; unsafe generic token-product separation** |

All guides were reviewed against primary sources on 2026-11-11 and require quarterly review. No hosted provider is called by CI.
