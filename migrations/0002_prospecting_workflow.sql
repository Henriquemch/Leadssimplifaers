-- Minimal workflow fields. Store current state plus compact audit events only.
ALTER TABLE companies ADD COLUMN qualification_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (qualification_status IN ('pending','approved','rejected'));
ALTER TABLE companies ADD COLUMN qualification_notes TEXT;
ALTER TABLE companies ADD COLUMN qualified_at TEXT;

ALTER TABLE companies ADD COLUMN customer_status TEXT NOT NULL DEFAULT 'unknown'
  CHECK (customer_status IN ('yes','no','unknown'));
ALTER TABLE companies ADD COLUMN contacted_status TEXT NOT NULL DEFAULT 'unknown'
  CHECK (contacted_status IN ('yes','no','unknown'));
ALTER TABLE companies ADD COLUMN active_process_status TEXT NOT NULL DEFAULT 'unknown'
  CHECK (active_process_status IN ('yes','no','unknown'));
ALTER TABLE companies ADD COLUMN commercial_notes TEXT;
ALTER TABLE companies ADD COLUMN commercial_status TEXT NOT NULL DEFAULT 'pending_review'
  CHECK (commercial_status IN ('pending_review','eligible','not_contact'));

CREATE TABLE IF NOT EXISTS company_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('qualification_changed','commercial_check_changed','commercial_status_changed')),
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_companies_qualification ON companies(qualification_status);
CREATE INDEX IF NOT EXISTS idx_companies_commercial ON companies(commercial_status);
CREATE INDEX IF NOT EXISTS idx_company_events_company ON company_events(company_id, created_at DESC);
