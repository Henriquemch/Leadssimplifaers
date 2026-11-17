-- Four-tab prospecting workflow: LinkedIn first, SABI fallback, validated potential clients, retained rejections.
ALTER TABLE companies ADD COLUMN linkedin_company_url TEXT;
ALTER TABLE companies ADD COLUMN linkedin_status TEXT NOT NULL DEFAULT 'not_checked'
  CHECK (linkedin_status IN ('not_checked','found','not_found'));
ALTER TABLE companies ADD COLUMN contact_research_status TEXT NOT NULL DEFAULT 'not_started'
  CHECK (contact_research_status IN ('not_started','linkedin_pending','sabi_pending','sabi_imported','decision_maker_found'));
ALTER TABLE companies ADD COLUMN lead_source TEXT
  CHECK (lead_source IS NULL OR lead_source IN ('linkedin','sabi','manual'));
ALTER TABLE companies ADD COLUMN potential_client_at TEXT;

-- Decision-maker contact fields are already managed by migration 0011_decision_maker_contact_fields.sql.
-- Keep this migration focused on company workflow state.

CREATE INDEX IF NOT EXISTS idx_companies_potential_clients
  ON companies(potential_client_at DESC);
CREATE INDEX IF NOT EXISTS idx_companies_contact_research
  ON companies(contact_research_status, qualification_status);
CREATE INDEX IF NOT EXISTS idx_decision_makers_review
  ON decision_makers(company_id, review_status);
