# Cloudflare D1 + Workers — migration foundation

This is a **parallel migration branch**. It does not change the live Netlify site or the `main` branch.

## Components
- Netlify continues to host the existing static dashboard.
- Cloudflare Worker is the API entry point.
- Cloudflare D1 stores normalized records.
- GitHub Actions remains responsible for downloading and parsing official BASE datasets; it will send small idempotent batches to the Worker.
- The existing Supabase schema and setup guide remain untouched as historical reference.

## Files
- `migrations/0001_initial.sql`: SQLite/D1 equivalent of the initial six-table schema.
- `worker/index.mjs`: initial API skeleton: health check, protected company read endpoint and protected batch upsert endpoint.
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
