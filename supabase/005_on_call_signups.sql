-- ============================================================
-- 005 — On-Call availability signups
-- Additive only. Does not touch existing shifts/applications.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.on_call_signups (
  id bigserial PRIMARY KEY,
  name_entered text NOT NULL,
  email text NOT NULL,
  normalized_email text NOT NULL,
  phone text NOT NULL,
  date date NOT NULL,
  role_preference text NOT NULL DEFAULT 'guard' CHECK (role_preference IN ('guard', 'manager', 'either')),
  availability_type text NOT NULL CHECK (availability_type IN ('early', 'late', 'both', 'custom', 'extra_availability')),
  custom_start text,
  custom_end text,
  estimated_hours numeric NOT NULL DEFAULT 0,
  already_scheduled boolean NOT NULL DEFAULT false,
  scheduled_shift_label text,
  scheduled_shift_start timestamptz,
  scheduled_shift_end timestamptz,
  scheduled_shift_hours numeric,
  extra_availability_type text CHECK (extra_availability_type IS NULL OR extra_availability_type IN ('stay_after_early', 'come_in_earlier', 'all_day_if_approved', 'custom')),
  note text DEFAULT '',
  vector_user_id text,
  vector_employee_id text,
  vector_full_name text,
  vector_email text,
  current_week_hours_at_signup numeric,
  projected_hours_if_used numeric,
  would_be_ot boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed', 'used', 'expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  CONSTRAINT on_call_custom_times CHECK (availability_type <> 'custom' OR (custom_start IS NOT NULL AND custom_end IS NOT NULL)),
  CONSTRAINT on_call_extra_type CHECK (availability_type <> 'extra_availability' OR extra_availability_type IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_on_call_active_date ON public.on_call_signups(status, date);
CREATE INDEX IF NOT EXISTS idx_on_call_email_date ON public.on_call_signups(normalized_email, date);
CREATE INDEX IF NOT EXISTS idx_on_call_status_email ON public.on_call_signups(status, normalized_email);

ALTER TABLE public.on_call_signups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "on_call_deny_all" ON public.on_call_signups;
CREATE POLICY "on_call_deny_all" ON public.on_call_signups FOR ALL USING (false) WITH CHECK (false);

GRANT SELECT, INSERT, UPDATE ON public.on_call_signups TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.on_call_signups_id_seq TO service_role;
