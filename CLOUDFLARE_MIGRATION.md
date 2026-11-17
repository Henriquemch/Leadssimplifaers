# LeadPilot — Cloudflare staging and workflow notes

## Environment and safety

This remains a parallel staging implementation. Do not merge into `main` or change the production Netlify site without explicit approval.

- Frontend: Netlify static site.
- API: Cloudflare Worker `leadpilot-api-dev`.
- Database: Cloudflare D1 `leadpilot`.
- Netlify proxies `/api/leadpilot/*` to the Worker through `netlify/functions/leadpilot.mjs`.
- Secrets stay in Cloudflare Worker / Netlify environment settings and must never be committed.

The prior infrastructure checkpoint confirmed the staging Worker health endpoint and D1 binding. The earlier checkpoint reported seven migrations applied. This branch now contains migrations 0008, 0009 and 0010 as well; verify the remote D1 migration list before applying anything. Do not assume migrations 0008–0010 have already been applied.

## Current data model

- `discovery_profiles`: compact company discovery profile, separate from the commercial pipeline.
- `discovery_contracts`: normalized contract evidence associated with a company NIF.
- `companies`: companies admitted to LeadPilot and their qualification/commercial workflow.
- `decision_makers`: contacts and managers found through LinkedIn or imported from SABI.
- `lead_registry`: permanent NIF/name identity registry to prevent duplicate discovery.
- `lead_exclusions`: administrative exclusions.
- `company_events`: compact audit history.

Migrations 0001–0010 are incremental. Migration 0010 adds LinkedIn page/status, SABI research status, potential-client promotion fields and the decision-maker fields used by the API.

## Approved four-tab workflow

1. **Pesquisa** — BASE discovery, with a maximum of 30 results per page.
2. **Identificação** — objective procurement evidence; manual approval/rejection; LinkedIn-first decision-maker research; SABI fallback for companies without an identified decision-maker.
3. **Potenciais clientes** — a company appears after at least one decision-maker is manually validated.
4. **Rejeitados** — rejected companies remain archived and can be requalified.

No weighted score or artificial qualification score is used. The application displays contract facts such as counts, awarded values, dates, CPVs, authorities and historical evolution.

### LinkedIn behavior

The UI generates company/person search URLs using the company name. The user confirms the official company page, pastes its direct URL and records the decision-maker. The application does not scrape LinkedIn, bypass login or collect private profile data.

### SABI behavior

- Mark companies without an identified LinkedIn decision-maker as `sabi_pending`.
- Copy all pending company NIFs in bulk.
- Export the SABI results as CSV with one person per row and a company NIF.
- Import CSV into LeadPilot; imported decision-makers remain pending.
- Manually validate a decision-maker to promote the company to Potenciais clientes.

No SABI API connection is implemented.

## BASE data window and import

The approved historical scope is a rolling five-year window. The importer in `scripts/import-base-contracts.py` uses a five-year cutoff and the discovery UI defaults to five years.

The public datasets are updated according to the source publisher's release schedule; the current importer downloads the published datasets. This is not a guaranteed real-time transactional BASE.gov API connection.

The previous parser dry-run statistics were produced for an earlier 12-month test window and must not be represented as a five-year import. No real BASE import has been run as part of this feature branch.

Before any real import:
1. Verify the source manifest and current official resource URLs.
2. Run a five-year dry-run and inspect counts/storage estimates.
3. Obtain explicit approval before setting `LEADPILOT_DRY_RUN=false`.
4. Start with a bounded test import and measure D1 storage.
5. Never upgrade a paid plan or incur charges without explicit approval.

## Secrets and deployment

Worker secrets required for staging:
- `ADMIN_PASSWORD`
- `SESSION_SECRET` (at least 32 random characters)
- `INGEST_SECRET`

Worker variable:
- `APP_ORIGIN` must exactly match the Netlify preview origin.

Netlify preview variable:
- `LEADPILOT_WORKER_URL` must point to the staging Worker origin.

Do not configure production secrets or production origins as part of this branch. After verifying the remote D1 migrations, deploy only to staging and test login, discovery, LinkedIn status, SABI import, promotion and rejection/requalification.

## Known limitations in this first test

- LinkedIn lookup is assisted, not automatic profile extraction.
- SABI is a manual CSV export/import process.
- The generative AI summary layer is not enabled; there is no numeric score. Contract metrics are displayed from imported evidence.
- Dynamics 365 remains manual; API integration is future work.
- One user only; no teams or role permissions.
