-- ============================================================
-- 006 — On-Call ergonomics / approval enhancements
-- Additive only. Does not modify existing shift/application data.
-- ============================================================

ALTER TABLE public.on_call_signups
  ADD COLUMN IF NOT EXISTS related_shift_id bigint,
  ADD COLUMN IF NOT EXISTS related_application_id bigint,
  ADD COLUMN IF NOT EXISTS used_at timestamptz;

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS on_call_signup_id bigint,
  ADD COLUMN IF NOT EXISTS on_call_resolution_type text,
  ADD COLUMN IF NOT EXISTS on_call_custom_start text,
  ADD COLUMN IF NOT EXISTS on_call_custom_end text,
  ADD COLUMN IF NOT EXISTS on_call_estimated_hours numeric,
  ADD COLUMN IF NOT EXISTS on_call_note text,
  ADD COLUMN IF NOT EXISTS on_call_phone text,
  ADD COLUMN IF NOT EXISTS on_call_projected_hours_if_used numeric,
  ADD COLUMN IF NOT EXISTS on_call_would_be_ot boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS on_call_approval_mode text,
  ADD COLUMN IF NOT EXISTS on_call_lc_custom_start text,
  ADD COLUMN IF NOT EXISTS on_call_lc_custom_end text,
  ADD COLUMN IF NOT EXISTS on_call_lc_instructions text,
  ADD COLUMN IF NOT EXISTS on_call_approved_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_applications_on_call_signup_id ON public.applications(on_call_signup_id);
CREATE INDEX IF NOT EXISTS idx_on_call_related_application ON public.on_call_signups(related_application_id);
