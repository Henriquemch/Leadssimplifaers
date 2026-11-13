# LeadPilot authentication setup

The Worker uses signed, short-lived browser sessions. The browser must never receive an administrative bearer token.

## Required Worker secrets

Configure these as Cloudflare Worker secrets (never commit their values):

- `ADMIN_PASSWORD`: strong, unique password used on the private LeadPilot login screen.
- `SESSION_SECRET`: at least 32 characters of cryptographically random secret material.
- `INGEST_SECRET`: separate secret used only by the trusted ingestion job.

Configure `APP_ORIGIN` as a Worker variable, not a secret. It must exactly match the browser application's origin, including scheme and host. When Netlify proxies `/auth/*` and `/api/*` to the Worker on the same origin, use the Netlify site origin (for example, the production Netlify URL).

## Cookie and proxy requirements

- The Worker sets an HttpOnly, Secure, SameSite=Lax, Path=/ host-only cookie.
- The browser must call the proxied API with same-origin credentials; do not expose Worker secrets in HTML or JavaScript.
- Keep the proxy same-origin. Do not point browser requests directly at a different `workers.dev` host with this cookie configuration.
- Do not enable the public application until the Netlify proxy, `APP_ORIGIN`, D1 binding, and secrets have been configured and tested together.

## Session behavior

Sessions are HMAC-SHA-256 signed, expire after 12 hours, and are validated on every `/api/*` request. Mutating API requests must carry the exact configured Origin. Logout expires the cookie. Ingestion remains separate under `/internal/*` and uses only `INGEST_SECRET`.

No secrets, passwords, session tokens, or personal data belong in this repository.
