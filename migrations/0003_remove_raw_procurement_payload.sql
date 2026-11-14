-- Keep only normalized procurement fields; never persist complete source payloads.
ALTER TABLE procurements DROP COLUMN source_record;
