-- Extend locally stored decision-maker records for contact qualification.
ALTER TABLE decision_makers ADD COLUMN email TEXT;
ALTER TABLE decision_makers ADD COLUMN phone TEXT;
ALTER TABLE decision_makers ADD COLUMN contact_type TEXT NOT NULL DEFAULT 'decision_maker'
  CHECK (contact_type IN ('general','decision_maker'));
ALTER TABLE decision_makers ADD COLUMN review_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (review_status IN ('pending','selected','rejected'));
ALTER TABLE decision_makers ADD COLUMN notes TEXT;
CREATE INDEX IF NOT EXISTS idx_decision_makers_company_status
  ON decision_makers(company_id, review_status);
