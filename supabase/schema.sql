-- LeadPilot initial schema. Apply in Supabase SQL Editor.
-- RLS is enabled and intentionally has no public policies: browser access is denied
-- until authentication and least-privilege policies are implemented.
create extension if not exists pgcrypto;

create table if not exists public.companies (
 id uuid primary key default gen_random_uuid(),
 nif text unique,
 name text not null,
 municipality text,
 district text,
 sector text,
 website text,
 source_url text,
 evidence_type text not null default 'unverified'
   check (evidence_type in ('competitor_confirmed','awardee','potential','unverified')),
 first_seen_at timestamptz not null default now(),
 last_seen_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table if not exists public.procurements (
 id uuid primary key default gen_random_uuid(),
 source_id text not null unique,
 company_id uuid references public.companies(id) on delete set null,
 participant_role text not null default 'unknown'
   check (participant_role in ('awardee','competitor_confirmed','unknown')),
 procedure_type text,
 cpv text,
 description text,
 contracting_authority text,
 contract_value numeric(16,2),
 publication_date date,
 procedure_url text,
 source_dataset text not null,
 source_record jsonb not null default '{}'::jsonb,
 imported_at timestamptz not null default now(),
 created_at timestamptz not null default now()
);

create table if not exists public.decision_makers (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete cascade,
 full_name text,
 job_title text,
 department text,
 professional_profile_url text,
 source_url text,
 provider text,
 approval_status text not null default 'not_requested'
   check (approval_status in ('not_requested','pending','approved','rejected','enriched')),
 contact_email text,
 contact_phone text,
 lusha_checked_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table if not exists public.approval_events (
 id uuid primary key default gen_random_uuid(),
 decision_maker_id uuid not null references public.decision_makers(id) on delete cascade,
 event_type text not null check (event_type in ('requested','approved','rejected','enrichment_started','enrichment_completed','enrichment_failed')),
 actor_user_id uuid references auth.users(id) on delete set null,
 details jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);

create table if not exists public.import_runs (
 id uuid primary key default gen_random_uuid(),
 source_key text not null,
 status text not null check (status in ('started','completed','failed','partial')),
 records_seen integer not null default 0,
 records_inserted integer not null default 0,
 records_updated integer not null default 0,
 error_message text,
 started_at timestamptz not null default now(),
 finished_at timestamptz
);

create table if not exists public.source_files (
 id uuid primary key default gen_random_uuid(),
 source_key text not null,
 resource_url text not null,
 resource_title text,
 file_format text,
 source_modified_at timestamptz,
 checksum_sha256 text,
 downloaded_at timestamptz,
 imported_at timestamptz,
 status text not null default 'discovered'
   check (status in ('discovered','downloaded','imported','failed','ignored')),
 error_message text,
 unique(source_key,resource_url)
);

create index if not exists idx_companies_name on public.companies using gin (to_tsvector('simple', name));
create index if not exists idx_companies_evidence on public.companies(evidence_type);
create index if not exists idx_procurements_company on public.procurements(company_id);
create index if not exists idx_procurements_date on public.procurements(publication_date desc);
create index if not exists idx_procurements_cpv on public.procurements(cpv);
create index if not exists idx_decision_makers_company on public.decision_makers(company_id);
create index if not exists idx_decision_makers_approval on public.decision_makers(approval_status);
create index if not exists idx_import_runs_started on public.import_runs(started_at desc);

alter table public.companies enable row level security;
alter table public.procurements enable row level security;
alter table public.decision_makers enable row level security;
alter table public.approval_events enable row level security;
alter table public.import_runs enable row level security;
alter table public.source_files enable row level security;

-- No anon/authenticated policies yet. All access is denied by default.
-- The server-side importer will use the Supabase secret key stored only in Netlify.
-- Before the dashboard reads these tables, add Supabase Auth and owner-scoped policies.
