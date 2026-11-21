# Security policy

[README](README.md) · [Threat model](docs/security/threat-model.md)

Report vulnerabilities privately through [GitHub Security Advisories](https://github.com/sandrinodm/serverless-jwt/security/advisories/new).
Do not include access tokens or other credentials in a public issue. Include the affected
package/version, a minimal reproduction and the trust boundary involved.

Only the latest minor release receives security fixes. During the 1.0 release-candidate
period, only the latest release candidate is supported. The obsolete 0.x line is unsupported.

We aim to acknowledge reports within seven days and coordinate a fix and disclosure within
90 days. We agree disclosure timing with the reporter, taking active exploitation and
available mitigations into account. Acknowledgement and target dates are commitments to
communicate, not guarantees of a fix by a particular date.

The scope covers the verifier, official integrations, JWKS/discovery transport and caches,
claim mapping, error responses, build-policy enforcement, and the release supply chain.
See the [threat model](docs/security/threat-model.md) for supported threats and boundaries.
Framework ingress behavior and hosted platform configuration must be included in reports
when they affect whether the library can observe a request.
