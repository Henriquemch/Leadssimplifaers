-- LeadPilot D1 schema (SQLite). New database only; preserves the original Supabase schema.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  nif TEXT UNIQUE,
  name TEXT NOT NULL,
  municipality TEXT,
  district TEXT,
  sector TEXT,
  website TEXT,
  source_url TEXT,
  evidence_type TEXT NOT NULL DEFAULT 'unverified'
    CHECK (evidence_type IN ('competitor_confirmed','awardee','potential','unverified')),
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS procurements (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL UNIQUE,
  company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
  participant_role TEXT NOT NULL DEFAULT 'unknown'
    CHECK (participant_role IN ('awardee','competitor_confirmed','unknown')),
  procedure_type TEXT,
  cpv TEXT,
  description TEXT,
  contracting_authority TEXT,
  contract_value REAL,
  publication_date TEXT,
  procedure_url TEXT,
  source_dataset TEXT NOT NULL,
  source_record TEXT NOT NULL DEFAULT '{}',
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS decision_makers (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  full_name TEXT,
  job_title TEXT,
  department TEXT,
  professional_profile_url TEXT,
  source_url TEXT,
  provider TEXT,
  approval_status TEXT NOT NULL DEFAULT 'not_requested'
    CHECK (approval_status IN ('not_requested','pending','approved','rejected','enriched')),
  contact_email TEXT,
  contact_phone TEXT,
  lusha_checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS approval_events (
  id TEXT PRIMARY KEY,
  decision_maker_id TEXT NOT NULL REFERENCES decision_makers(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('requested','approved','rejected','enrichment_started','enrichment_completed','enrichment_failed')),
  actor_user_id TEXT,
  details TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS import_runs (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started','completed','failed','partial')),
  records_seen INTEGER NOT NULL DEFAULT 0,
  records_inserted INTEGER NOT NULL DEFAULT 0,
  records_updated INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS source_files (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL,
  resource_url TEXT NOT NULL,
  resource_title TEXT,
  file_format TEXT,
  source_modified_at TEXT,
  checksum_sha256 TEXT,
  downloaded_at TEXT,
  imported_at TEXT,
  status TEXT NOT NULL DEFAULT 'discovered'
    CHECK (status IN ('discovered','downloaded','imported','failed','ignored')),
  error_message TEXT,
  UNIQUE(source_key, resource_url)
);

CREATE INDEX IF NOT EXISTS idx_companies_name ON companies(name);
CREATE INDEX IF NOT EXISTS idx_companies_evidence ON companies(evidence_type);
CREATE INDEX IF NOT EXISTS idx_procurements_company ON procurements(company_id);
CREATE INDEX IF NOT EXISTS idx_procurements_date ON procurements(publication_date DESC);
CREATE INDEX IF NOT EXISTS idx_procurements_cpv ON procurements(cpv);
CREATE INDEX IF NOT EXISTS idx_decision_makers_company ON decision_makers(company_id);
CREATE INDEX IF NOT EXISTS idx_decision_makers_approval ON decision_makers(approval_status);
CREATE INDEX IF NOT EXISTS idx_import_runs_started ON import_runs(started_at DESC);
