# `/api/account` contract (IdP ↔ iOS app)

What the iOS app `com.hoandat.account` (client `account-ios`) sends and
expects. The app is built against this file; the server side
(`src/account-api/`) implements it. The JSON files next to this README are
the shared fixtures: the Swift tests decode them
(`ios/AccountKit/Tests/AccountKitTests/AccountAPITests.swift`), and the Node
contract test (`src/__tests__/account-api-contract.test.ts`) compares the
real `GET /api/account` output against `account.json`.

## OIDC client

| Item | Value the app uses |
|---|---|
| Discovery | `GET <issuer>/.well-known/openid-configuration`; needs `issuer` (exact match, no trailing `/`), `authorization_endpoint`, `token_endpoint`, `revocation_endpoint`, all `https` on the issuer host; `code_challenge_methods_supported` must contain `S256` if present |
| `client_id` | `account-ios`, public (`token_endpoint_auth_method: none`) |
| Redirect URIs | `<issuer>/ios/callback` (sign-in), `<issuer>/ios/linked` (provider link result) |
| Scope | `openid profile email account` (no `offline_access`; the client must still get a refresh token, device-bound) |
| Authorize params | `response_type=code`, `state`, `nonce`, `code_challenge` + `S256`, optional `prompt=login` (re-authentication), `device_name` (sanitised to the IdP pattern), `ui_locales` (`en`, `vi`, `zh-CN`) |
| Callback | `?code&state` (+ `iss` checked when present, RFC 9207); `?error=access_denied` is treated as cancel |
| Token response | `access_token`, `token_type: Bearer`, `expires_in`, `refresh_token` (always, rotating), `id_token` |
| ID token | `iss`, `sub`, `aud` contains `account-ios`, `exp`, `nonce` (echoed), **`auth_time` (required: `require_auth_time`)** |
| Refresh | `grant_type=refresh_token&refresh_token&client_id`; any 4xx with an OAuth `error` (except 429) ends the session in the app; 5xx/429/offline keep it |
| Revocation | `POST revocation_endpoint` `token=<refresh>&token_type_hint=refresh_token&client_id=account-ios`, expects 200 |

The app never sends a client secret, never stores the ID token, and keeps
`{accessToken, accessTokenExpiresAt, refreshToken, accountID}` in one
Keychain item (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`).

### Re-authentication (every sensitive call)

1. Authorize with `prompt=login` (same client, new state/nonce/PKCE).
2. Exchange the code: a **new device grant**. The app checks `sub` equals the
   signed-in account (else revokes the new refresh token and stops) and
   `auth_time` is at most 8 minutes old (the API allows 10).
3. The app switches to the new tokens, then revokes the **old** refresh token,
   so the phone keeps one row under Devices.
4. If push is on, the app sends `PUT /api/account/push-device` again with the
   new access token (the old grant's row dies with the old grant).
5. The new `id_token` goes once into the body of the sensitive call.

## Common rules for `/api/account`

- `Authorization: Bearer <opaque access token of account-ios>` on every call;
  no cookies, no CSRF.
- Request bodies are JSON (`Content-Type: application/json`); responses are
  JSON or empty `204`.
- Sensitive calls carry `{"id_token": "<fresh ID token>"}` in the body.
- Dates are ISO 8601 strings; `Date.prototype.toISOString()` output (with
  milliseconds) is expected, without fraction is accepted.
- Optional fields may be `null` or absent. Unknown fields are ignored; an
  unknown `provider` value still decodes. Arrays are always present.
- After a `401` the app refreshes once and retries once; a second `401` ends
  the session (back to the sign-in screen).

### Errors

Every non-2xx response with a body uses
`{"error": "<code>", "error_description": "<English, not shown>"}`
(see `errors.json`). The app maps these codes:

| Status | `error` | App behaviour |
|---|---|---|
| 401 | `invalid_token` (+ `WWW-Authenticate: Bearer error="invalid_token"`) | refresh + retry once, then sign out ("session ended") |
| 403 | `insufficient_scope` | generic error (wrong client / missing `account` scope) |
| 403 | `reauth_required` | "confirm it's you again" (missing, stale, wrong `aud`/`sub`, or reused `id_token`) |
| 404 | `not_found` | "no longer there", list reloads |
| 409 | `last_sign_in_method` | unlink refused: no other usable provider |
| 409 | `provider_unavailable` | provider not enabled on this IdP |
| 409 | `already_linked` | provider already linked to this account |
| 400 | `username_mismatch` | delete: typed username differs |
| 400 | `invalid_name` | profile: name longer than 100 characters |
| 400 | `invalid_request` | generic error |
| 429 | `rate_limited` (+ `Retry-After` seconds) | "too many attempts" |
| 5xx | `server_error` or no body | generic error |

## Endpoints the app calls

| Method and path | Guard | Body | Success |
|---|---|---|---|
| `GET /api/account` | bearer | — | `200` snapshot below |
| `PATCH /api/account/profile` | bearer | `{"name": "<trimmed, ≤100, empty clears>"}` | `204` |
| `POST /api/account/sessions/:uid/revoke` | bearer | — | `204` |
| `POST /api/account/devices/:grantId/revoke` | bearer | — | `204` (the app never sends its own grant) |
| `POST /api/account/apps/:clientId/revoke` | bearer + re-auth | `{"id_token"}` | `204` |
| `POST /api/account/sessions/revoke-all` | bearer + re-auth | `{"id_token"}` | `204` (all browser sessions) |
| `POST /api/account/providers/:provider/unlink` | bearer + re-auth | `{"id_token"}` | `204` |
| `POST /api/account/providers/:provider/link` | bearer + re-auth | `{"id_token"}` | `200` `{"url": "<https URL on the issuer host>"}` (`link-start.json`) |
| `POST /api/account/providers/:provider/link/complete` | bearer (same grant that started the link) | `{"ref"}` | `200` `{"result": "linked" \| "owned_by_other" \| "already_linked" \| "expired" \| "failed"}` (`link-complete.json`); `404 not_found` when the ref does not belong to this grant |
| `DELETE /api/account` | bearer + re-auth | `{"id_token", "username"}` | `204` |
| `PUT /api/account/push-device` | bearer | `{"token", "environment", "locale"}` (`push-device.json`) | `204` |
| `DELETE /api/account/push-device` | bearer | — | `204` (also when nothing is registered) |

Path parameters are percent-encoded path segments (`/` becomes `%2F`).
`:provider` is `apple`, `google` or `github`.

### `GET /api/account` (`account.json`, `account-minimal.json`)

```text
account:
  id                string   OIDC sub
  username          string
  name              string?  display name
  email             string?
  emailVerifiedBy   "google" | "github" | "apple" | null
  picture           string?  URL
  createdAt         date
  reclaimedEmail    { email: string, at: date }?
providers[]         one per provider the IdP knows, in UPSTREAM_PROVIDERS order
  provider          "apple" | "google" | "github"
  enabled           bool     offered by this IdP now
  linked            bool
  email             string?  providerDetails.email
  login             string?  providerDetails.login (GitHub)
  linkedAt          date?
  canUnlink         bool     linked AND another linked + enabled provider remains
                             (the usableSignInProviders rule; the app shows it, the
                             server enforces it)
telegram:
  available         bool     bot configured
  linked            bool
  username          string?
  name              string?
  linkedAt          date?
sessions[]          browser sessions (OpenSession)
  uid               string
  loginAt           date?
  lastSeenAt        date?
  browser           string?  label from the User-Agent ("Safari"), null if unknown
  os                string?  label from the User-Agent ("macOS"), null if unknown
  ip                string?
devices[]           per-device grants (DeviceGrant)
  grantId           string
  clientId          string
  appName           string
  deviceName        string?
  grantedAt         date?
  expiresAt         date?
  current           bool     grant of the access token making this request
apps[]              other grants grouped per client (AuthorizedApp)
  clientId          string
  name              string
  firstParty        bool
  redirectHosts     string[]
  scopes            string[]
canDelete           bool     always true: every account deletes itself (ADR 0009, 0013)
```

Never included: `revocationToken`, raw `providerDetails`, `securityVersion`,
`tenantId`, `disabledAt`, `reviewLogin`, Telegram `chatId`, grant ids of
`apps[]`.

### Provider link (`/ios/linked`, then `…/link/complete`)

The provider step never links by itself (that would let a link started in
someone else's browser land on this account). The flow is:

1. `POST …/providers/:provider/link` (after re-auth) returns the IdP URL;
   the app opens it in the browser sheet.
2. After the provider step the IdP redirects `303` to
   `<issuer>/ios/linked?result=pending&ref=<ref>&provider=<id>`. If the
   provider step failed or was cancelled it redirects with
   `result=expired | failed | cancelled` instead (no `ref`), and the app
   shows that outcome without a further call (`cancelled` may be shown as
   `failed`). `owned_by_other` and `already_linked` only come from step 3.
3. On `result=pending` the app calls
   `POST …/providers/:provider/link/complete` with its bearer token and
   `{"ref": "<ref>"}`. Only the `result` of that response is shown, then the
   snapshot reloads.

App rules: `result=pending` without a non-empty `ref` is shown as `failed`;
a bare `result=linked` in the redirect is not trusted and is shown as
`failed`; any unknown `result` (redirect or completion) is `failed`. The ref
is held in memory for the one completion call only, never logged or stored.

### Push device (`push-device.json`)

- `token`: APNs device token, lowercase hex (64 characters today; accept
  longer).
- `environment`: `sandbox` (development-signed builds) or `production`
  (TestFlight, App Store), read from the embedded provisioning profile.
- `locale`: `en`, `vi` or `zh-CN`, the language the app runs in.

The token is bound to the grant of the access token. The app sends it after
the person turns notifications on, on every launch while on (tokens can
change), and after each re-authentication; it sends `DELETE` before signing
out.

### Notification payload the app reads

Standard `aps.alert` (title/body already localised by the IdP, no email,
code, token or link), plus one custom top-level key:

```json
{ "aps": { "alert": { "title": "…", "body": "…" }, "sound": "default" }, "kind": "new-sign-in" }
```

`kind` ∈ `new-sign-in` (opens Browser sessions), `access-revoked` (Devices),
`provider-linked` / `provider-unlinked` (Sign-in methods), `email-reclaimed`
(Profile). Unknown kinds just open the app.
