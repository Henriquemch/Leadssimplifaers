# Cloudflare D1 + Workers — migration foundation

This is a **parallel staging migration branch**. It does not change the live Netlify site or the `main` branch.

## Current infrastructure state

- Cloudflare D1 database `leadpilot` has been created manually by the account owner.
- D1 database ID: `fcea37de-694c-4bc2-ad72-4b70c8e21740`.
- Seven D1 migrations have been applied successfully. The API health endpoint confirms that the Worker can see its D1 binding. No BASE records have been imported.
- The staging Worker `leadpilot-api-dev` has been deployed successfully at `https://leadpilot-api-dev.henriquemvm98.workers.dev`. Its `/health` endpoint returns `ok: true` and `database_configured: true`. No application authentication secrets have been configured yet.
- `wrangler.toml` targets a staging Worker named `leadpilot-api-dev`, with `APP_ENV = "staging"`, and binds the existing D1 database as `DB`.
- The production Netlify site and `main` branch remain untouched.

## Architecture

- Netlify hosts the static dashboard and proxies `/.netlify/functions/leadpilot/*`.
- The Cloudflare Worker is the API entry point.
- Cloudflare D1 stores compact company profiles and the manually admitted lead/CRM workflow.
- GitHub Actions downloads and parses official BASE datasets; it sends compact, idempotent batches only after the Worker is configured and a real import is explicitly authorized.
- The current import scope is a rolling 12-month window.

## Important files

- `migrations/`: D1 schema and incremental migrations, including compact discovery profiles and lead exclusions.
- `worker/index.mjs`: authenticated API, discovery search, manual lead admission, exclusion management and protected BASE import endpoint.
- `scripts/import-base-contracts.py` and `scripts/profile-contract-data.py`: BASE parsing and compact profile aggregation.
- `.github/workflows/test-parser.yml`: parser, migration and frontend syntax checks.
- `.github/workflows/import-base-contracts.yml`: import workflow; push-triggered runs are forced into dry-run mode.
- `netlify/functions/leadpilot.mjs`: same-origin Netlify proxy. It requires `LEADPILOT_WORKER_URL` before it forwards requests.

## Data minimization and admission rules

- BASE discovery profiles are separate from admitted leads.
- Search results do not automatically become CRM leads. A user must explicitly choose **Adicionar ao LeadPilot**.
- Profiles contain company identity, aggregate participation/awardee counts, awarded-value totals, latest contract date, top CPVs/authorities and a small number of recent evidence references.
- No raw ZIP archives, complete contract rows or full source payloads are stored in D1.
- The current search CPV filter matches the stored top-five CPV profile exactly; it does not search every historical CPV.
- Existing leads and active exclusion records are suppressed from discovery results.
- Exclusion reasons include current customer, active process, do not contact, duplicate, other and manual.
- Decision-maker research remains a later, explicit qualification step. No automatic CRM/Dynamics submission is implemented.

## Validation already completed

- Rolling 12-month dry-run cutoff: 2025-11-13.
- Source archives processed: 4.
- Source rows seen: 913,078.
- Rows in the 12-month window: 425,496.
- Companies profiled: 36,002.
- Company participations aggregated: 662,478.
- Estimated import batches: 721.
- Compact JSON transfer payload: 50,166,314 bytes (about 50.2 MB); this is **not** a measurement of final D1 storage or billing.
- Latest parser/Worker/frontend CI run passed on commit `f436c029da6eebe44a093dd430ca1b001d51f627`.
- Staging deployment workflow completed successfully; seven D1 migrations were applied and the Worker was deployed.
- Live `/health` test returned `{\"ok\":true,\"service\":\"leadpilot-api\",\"database_configured\":true}`.
- Live unauthenticated `/api/discovery/search` test returned HTTP 401 `Unauthorized`, confirming API protection.

## Secrets and environment

Do not commit secrets or paste them into chat. Before enabling the staging Worker, configure these as Worker secrets:

- `ADMIN_PASSWORD`
- `SESSION_SECRET` (at least 32 characters)
- `INGEST_SECRET`

Configure `APP_ORIGIN` as a normal Worker environment variable using the exact Netlify **preview** origin during testing. Configure Netlify's `LEADPILOT_WORKER_URL` only in the preview environment and only after the staging Worker has been deployed and verified.

The current authentication setup uses server-side session cookies. Keep the Netlify proxy in front of the Worker so the browser uses the same origin. Never expose secrets in frontend code.

## Safe next steps

1. Configure `ADMIN_PASSWORD`, `SESSION_SECRET`, `INGEST_SECRET`, and `APP_ORIGIN` on the staging Worker.
2. Configure preview-only Netlify `LEADPILOT_WORKER_URL` and test login through the same-origin proxy.
3. Test discovery, manual lead admission and exclusions with controlled test data.
4. Measure actual D1 storage using a small, explicitly approved import before considering the full 12-month import.

No production deployment, production environment changes, paid plan, billing upgrade, or real BASE import is authorized by this document. Do not merge this branch into `main` without the user's explicit approval.
