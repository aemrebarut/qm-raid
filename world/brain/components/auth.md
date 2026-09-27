---
type: concept
title: Auth
---
Auth handles password login, SSO (SAML and OIDC), sessions and reset links. Part of [[lumen]].

## House rules
- Token expiry checks always allow 120 seconds of clock skew against the identity provider. See [[rules/auth-clock-skew]].
- Sessions are refreshed by the refresh token, never by re-running SSO. A forced SSO round trip is a bug.
- Never log tokens, assertions or reset links, not even at debug level.

## Gotchas
- SSO customers' identity providers often run a few minutes fast. Without the skew allowance their sessions expire early.
- The session store TTL is in seconds but the SSO assertion lifetime is in minutes.

## Open issues
[[issues/lum-104]], [[issues/lum-105]]
