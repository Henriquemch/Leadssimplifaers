create extension if not exists pgcrypto;
create table if not exists public.companies(id uuid primary key default gen_random_uuid(),nif text unique,name text not null,municipality text,sector text,source_url text,evidence_type text not null default 'unverified' check(evidence_type in('competitor_confirmed','awardee','potential','unverified')),first_seen_at timestamptz default now(),last_seen_at timestamptz default now());
create table if not exists public.procurements(id uuid primary key default gen_random_uuid(),source_id text unique,company_id uuid references public.companies(id) on delete cascade,procedure_type text,cpv text,description text,contracting_authority text,contract_value numeric,publication_date date,source_url text,created_at timestamptz default now());
create table if not exists public.decision_makers(id uuid primary key default gen_random_uuid(),company_id uuid references public.companies(id) on delete cascade,full_name text,job_title text,source_url text,provider text,approval_status text not null default 'not_requested' check(approval_status in('not_requested','pending','approved','rejected','enriched')),lusha_checked_at timestamptz,created_at timestamptz default now());
create table if not exists public.audit_events(id uuid primary key default gen_random_uuid(),decision_maker_id uuid references public.decision_makers(id),event_type text not null,details jsonb default '{}'::jsonb,created_at timestamptz default now());
alter table public.companies enable row level security;
alter table public.procurements enable row level security;
alter table public.decision_makers enable row level security;
alter table public.audit_events enable row level security;
-- Definir políticas RLS e autenticação antes de expor dados pessoais na aplicação.