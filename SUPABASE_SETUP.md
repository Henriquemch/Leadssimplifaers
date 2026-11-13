# LeadPilot — setup Supabase

## Project settings
Create a Supabase project named `leadpilot`, choose a region in the EU (Frankfurt is a suitable low-latency option for Portugal), and keep the database password in your password manager.

## Database
1. Open the project Dashboard.
2. Go to SQL Editor → New query.
3. Open `supabase/schema.sql` in this repository, copy the complete contents, paste into SQL Editor and click Run.
4. Confirm the six tables exist in Table Editor: companies, procurements, decision_makers, approval_events, import_runs, source_files.

The schema enables RLS and intentionally grants no browser access yet. Do not disable RLS and do not create public policies.

## API keys
In Project Settings → API Keys (or the project's Connect dialog), retrieve:
- Project URL.
- Publishable key (`sb_publishable_...`) — intended for browser use after authentication and RLS are configured.
- Secret key (`sb_secret_...`) — backend only; never paste into GitHub, browser code, or this chat.

Supabase is deprecating legacy `anon` / `service_role` keys by the end of 2026; use publishable/secret keys for new integrations.

## Netlify environment variables
Once the project is created, add these in Netlify → Site configuration → Environment variables:
- `SUPABASE_URL` = project URL
- `SUPABASE_SECRET_KEY` = secret key (server-only)

Do not add the secret key with a `NEXT_PUBLIC_` prefix. Do not commit credentials.

## Current boundary
This repository contains the initial schema only. No Supabase project has been provisioned or connected yet. The application should not show imported leads until the importer and dashboard access controls are tested.
