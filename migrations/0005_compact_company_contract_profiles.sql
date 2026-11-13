-- One compact BASE profile per company. Detailed contract rows are not stored.
-- This replaces millions of company-contract links with a single summary row per company.
ALTER TABLE companies ADD COLUMN contract_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE companies ADD COLUMN awardee_contract_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE companies ADD COLUMN competitor_contract_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE companies ADD COLUMN awarded_value_total REAL NOT NULL DEFAULT 0;
ALTER TABLE companies ADD COLUMN latest_contract_date TEXT;
ALTER TABLE companies ADD COLUMN top_cpv_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE companies ADD COLUMN top_authorities_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE companies ADD COLUMN recent_contracts_json TEXT NOT NULL DEFAULT '[]';
DROP TABLE procurements;
