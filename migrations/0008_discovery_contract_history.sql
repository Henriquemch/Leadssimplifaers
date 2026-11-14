-- Complete discovery contract evidence, separate from manually admitted CRM procurements.
CREATE TABLE IF NOT EXISTS discovery_contracts (
  source_id TEXT NOT NULL,
  nif TEXT NOT NULL,
  company_name TEXT NOT NULL,
  participant_role TEXT NOT NULL CHECK (participant_role IN ('awardee','competitor_confirmed')),
  procedure_type TEXT,
  cpv TEXT,
  description TEXT,
  contracting_authority TEXT,
  contract_value REAL,
  publication_date TEXT,
  procedure_url TEXT,
  source_dataset TEXT NOT NULL DEFAULT 'BASE contratos',
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_id, nif)
);

CREATE INDEX IF NOT EXISTS idx_discovery_contracts_cpv ON discovery_contracts(cpv);
CREATE INDEX IF NOT EXISTS idx_discovery_contracts_date ON discovery_contracts(publication_date DESC);
CREATE INDEX IF NOT EXISTS idx_discovery_contracts_nif ON discovery_contracts(nif);
CREATE INDEX IF NOT EXISTS idx_discovery_contracts_role ON discovery_contracts(participant_role);
