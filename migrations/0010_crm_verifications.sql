CREATE TABLE IF NOT EXISTS crm_verifications (
  nif TEXT PRIMARY KEY CHECK (length(nif) = 9),
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('customer','not_customer','unknown')),
  checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
