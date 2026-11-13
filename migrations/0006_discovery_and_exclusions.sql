-- Separate BASE discovery index from manually admitted commercial leads.
-- Discovery profiles are searchable but are not leads and carry no sales workflow state.
CREATE TABLE IF NOT EXISTS discovery_profiles (
  id TEXT PRIMARY KEY,
  nif TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  source_url TEXT,
  evidence_type TEXT NOT NULL DEFAULT 'unverified'
    CHECK (evidence_type IN ('awardee','competitor_confirmed','unverified')),
  contract_count INTEGER NOT NULL DEFAULT 0,
  awardee_contract_count INTEGER NOT NULL DEFAULT 0,
  competitor_contract_count INTEGER NOT NULL DEFAULT 0,
  awarded_value_total REAL NOT NULL DEFAULT 0,
  latest_contract_date TEXT,
  top_cpv_json TEXT NOT NULL DEFAULT '[]',
  top_authorities_json TEXT NOT NULL DEFAULT '[]',
  recent_contracts_json TEXT NOT NULL DEFAULT '[]',
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_discovery_profiles_name ON discovery_profiles(name);
CREATE INDEX IF NOT EXISTS idx_discovery_profiles_awarded_value ON discovery_profiles(awarded_value_total DESC);
CREATE INDEX IF NOT EXISTS idx_discovery_profiles_latest ON discovery_profiles(latest_contract_date DESC);

-- Permanent NIF suppression list, managed only from the administrative backoffice.
CREATE TABLE IF NOT EXISTS lead_exclusions (
  nif TEXT PRIMARY KEY CHECK (length(nif) = 9),
  company_name TEXT,
  reason TEXT NOT NULL DEFAULT 'manual',
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reactivated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_lead_exclusions_active ON lead_exclusions(active);
