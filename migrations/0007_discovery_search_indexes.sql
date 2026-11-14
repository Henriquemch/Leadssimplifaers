-- Keep filtered discovery queries bounded and reduce sorting work.
CREATE INDEX IF NOT EXISTS idx_discovery_profiles_value_date ON discovery_profiles(awarded_value_total DESC, latest_contract_date DESC, id);
CREATE INDEX IF NOT EXISTS idx_discovery_profiles_date_value ON discovery_profiles(latest_contract_date DESC, awarded_value_total DESC, id);
