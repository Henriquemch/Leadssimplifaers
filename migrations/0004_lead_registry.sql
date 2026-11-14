-- Permanent company identity registry: only NIF and name.
-- Removing a lead from the pipeline must never make it discoverable again.
CREATE TABLE IF NOT EXISTS lead_registry (
  nif TEXT PRIMARY KEY CHECK (length(nif) = 9),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO lead_registry (nif, name)
SELECT nif, name FROM companies
WHERE nif IS NOT NULL AND length(nif) = 9;
CREATE INDEX IF NOT EXISTS idx_lead_registry_name ON lead_registry(name);
