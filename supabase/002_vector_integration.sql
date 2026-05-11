-- ============================================================
-- LAKEFRONT SHIFT SWAP — Migration 002: Vector integration
-- Safe on existing database. Adds columns only. No drops.
-- ============================================================

ALTER TABLE shifts ADD COLUMN IF NOT EXISTS vector_source text NOT NULL DEFAULT 'legacy'
  CHECK (vector_source IN ('vector_confirmed', 'lc_override', 'legacy'));
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS vector_check_status text;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS vector_checked_at timestamptz;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS vector_warnings jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE shifts ADD COLUMN IF NOT EXISTS lc_override_shift_length numeric;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS lc_override_shift_start text;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS lc_override_shift_end text;

ALTER TABLE shifts ADD COLUMN IF NOT EXISTS poster_vector_user_id bigint;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS poster_vector_employee_id text;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS poster_vector_full_name text;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS poster_vector_email text;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS poster_vector_shift_id bigint;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS poster_vector_assignment_id bigint;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS poster_vector_assignment_name text;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS poster_vector_shift_start text;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS poster_vector_shift_end text;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS poster_vector_shift_length numeric;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS poster_vector_work_type_name text;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS poster_vector_group_labels jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE shifts ADD COLUMN IF NOT EXISTS swap_partner_vector_user_id bigint;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS swap_partner_vector_employee_id text;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS swap_partner_vector_full_name text;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS swap_partner_vector_email text;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS swap_partner_vector_shift_id bigint;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS swap_partner_vector_assignment_id bigint;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS swap_partner_vector_assignment_name text;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS swap_partner_vector_shift_start text;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS swap_partner_vector_shift_end text;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS swap_partner_vector_shift_length numeric;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS swap_partner_vector_work_type_name text;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS swap_partner_vector_group_labels jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE shifts ADD COLUMN IF NOT EXISTS preferred_vector_user_id bigint;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS preferred_vector_employee_id text;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS preferred_vector_full_name text;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS preferred_vector_email text;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS preferred_vector_check_status text;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS preferred_vector_checked_at timestamptz;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS preferred_vector_warnings jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE applications ADD COLUMN IF NOT EXISTS applicant_vector_user_id bigint;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS applicant_vector_employee_id text;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS applicant_vector_full_name text;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS applicant_vector_email text;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS applicant_vector_week_hours numeric;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS applicant_vector_projected_hours numeric;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS applicant_vector_would_be_ot boolean NOT NULL DEFAULT false;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS applicant_vector_same_day_conflict boolean NOT NULL DEFAULT false;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS applicant_vector_check_status text;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS applicant_vector_checked_at timestamptz;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS applicant_vector_warnings jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_shifts_poster_vector_shift_id ON shifts(poster_vector_shift_id);
CREATE INDEX IF NOT EXISTS idx_shifts_swap_partner_vector_shift_id ON shifts(swap_partner_vector_shift_id);
CREATE INDEX IF NOT EXISTS idx_apps_applicant_vector_user_id ON applications(applicant_vector_user_id);
