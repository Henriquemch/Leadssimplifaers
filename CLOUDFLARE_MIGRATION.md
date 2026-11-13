# Cloudflare D1 + Workers — migration foundation

This is a **parallel migration branch**. It does not change the live Netlify site or the `main` branch.

## Components
- Netlify continues to host the existing static dashboard.
- Cloudflare Worker is the API entry point.
- Cloudflare D1 stores normalized records.
- GitHub Actions remains responsible for downloading and parsing official BASE datasets; it will send small idempotent batches to the Worker.
- The existing Supabase schema and setup guide remain untouched as historical reference.

## Files
- `migrations/0001_initial.sql`–`0005_*.sql`: D1 schema and prospecting workflow. Migration 0005 replaces individual procurement rows with one compact BASE profile per company.
- `worker/index.mjs`: authenticated dashboard API and protected compact BASE profile import endpoint (`/internal/import/batch`); it stores company aggregates and at most three recent evidence references, not individual contract rows.\n- `scripts/import-base-contracts.py`: manual rolling five-year importer for BASE awardees and explicitly listed competitors.\n- `.github/workflows/import-base-contracts.yml`: manual workflow with dry-run enabled by default.
- `wrangler.toml`: deployment configuration; database ID is intentionally a placeholder.
- Secrets are not committed. Configure `ADMIN_TOKEN` and `INGEST_SECRET` as Worker secrets before exposing data endpoints.

## Safety and current limits
- No Cloudflare account, D1 database, Worker deployment, API secret or data import has been created.
- `/health` reveals only service/database configuration.
- Company read and ingestion endpoints reject requests without server-side bearer secrets.
- The ingestion endpoint caps batches at 100 and validates stable IDs and names.
- The importer is not yet connected to Portal BASE. Do not treat this branch as a working CRM until schema, API, authentication, importer and live smoke tests pass.
- Do not merge this branch to `main` until tests pass and D1 capacity is estimated from actual source files.

## Next steps
1. Validate parser tests and the actual source file formats/sizes.
2. Add Worker unit tests and a D1 local integration test.
3. Implement authentication/session flow for the dashboard without exposing secrets in browser code.
4. Implement incremental, idempotent BASE import and storage-size measurement.
5. Only then create the Cloudflare D1 database and deploy the Worker.

## Official BASE source findings (13 Nov 2026)
- The IMPIC dataset is published as annual archives (e.g. `contratos2024.zip`, `contratos2025.zip`, `contratos2026.zip`) and is updated by the source. A third-party public-data audit reports 672,724 records across 2024–2026, which is useful as a scale indicator but is not a substitute for our own full-file audit.
- The five-year universe must be filtered by the contract's relevant date, not blindly by archive filename. The source itself notes that archive year and publication/contract dates can differ.
- Do not store complete raw JSON in D1. Keep the original source URL, BASE contract ID, NIF, company name, CPV, procedure type, dates, amount, authority and a small evidence/provenance payload only.
- Storage decision is pending the automated audit of the actual five-year archives. If one D1 database approaches its 500 MB free limit, evaluate year-based D1 sharding within the account-wide free allowance before importing; do not create databases or incur charges without approval.
- Official source pages: https://dados.gov.pt/pt/datasets/contratos-publicos-portal-base-impic-contratos-de-2012-a-2026 and https://www.base.gov.pt/Base4/pt/documentacao/formas-de-obter-dados-sobre-os-contratos-publicos/


## Cost and storage policy (13 Nov 2026)
- Do not import 3.5 million company-contract links. The full dry-run identified 68,687 companies and 3,502,896 participant links; persisting every link would create unnecessary storage and ingestion work.
- Migration 0005 drops the unused `procurements` table and keeps the company workflow in `companies`.
- Each company stores only counts (all participations, awardee participations, confirmed competitor participations), total awarded value, latest contract date, top five CPVs, top five contracting authorities and at most three recent contract references.
- Contract value is attributed only to awardees, never to competitors. A competitor is counted only when explicitly listed in the BASE competitors field.
- Import batches contain at most 50 company profiles and one D1 statement per company. The importer aggregates locally before sending; no contract-level rows or raw archive payloads are sent to D1.
- This reduces the expected import from tens of thousands of tiny requests and millions of rows to approximately 1,374 company profiles / batches (based on the current 68,687-company dry-run). The actual batch count is 1,374 at 50 profiles per batch.
- Keep GitHub Actions dry-run enabled until Cloudflare free-plan limits, database size, Worker request quotas and recurring source-download costs are checked. No paid plan, billing upgrade or automatic production import is authorized.
