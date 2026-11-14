-- One BASE contract may list multiple awardees and confirmed competitors.
-- Rebuild the small normalized table so the same source contract can link to several companies.
CREATE TABLE procurements_new (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
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
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_id, company_id)
);
INSERT INTO procurements_new (
  id, source_id, company_id, participant_role, procedure_type, cpv, description,
  contracting_authority, contract_value, publication_date, procedure_url, source_dataset,
  imported_at, created_at
)
SELECT id, source_id, company_id, participant_role, procedure_type, cpv, description,
  contracting_authority, contract_value, publication_date, procedure_url, source_dataset,
  imported_at, created_at
FROM procurements;
DROP TABLE procurements;
ALTER TABLE procurements_new RENAME TO procurements;
CREATE INDEX IF NOT EXISTS idx_procurements_company ON procurements(company_id);
CREATE INDEX IF NOT EXISTS idx_procurements_date ON procurements(publication_date DESC);
CREATE INDEX IF NOT EXISTS idx_procurements_cpv ON procurements(cpv);
