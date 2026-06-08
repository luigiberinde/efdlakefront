-- ============================================================
-- LAKEFRONT SHIFT SWAP — Migration 003: Current Vector hours refresh
-- Safe on existing database. Adds columns only. No drops.
-- ============================================================

ALTER TABLE applications ADD COLUMN IF NOT EXISTS applicant_vector_current_week_hours numeric;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS applicant_vector_current_projected_hours numeric;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS applicant_vector_current_would_be_ot boolean NOT NULL DEFAULT false;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS applicant_vector_current_checked_at timestamptz;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS applicant_vector_current_check_status text;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS applicant_vector_current_warnings jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_apps_vector_current_checked_at ON applications(applicant_vector_current_checked_at);
