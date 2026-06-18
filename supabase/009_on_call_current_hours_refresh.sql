-- ============================================================
-- 009 — On-Call current hours refresh + direct approval support
-- Additive only. Keeps existing On-Call data intact.
-- ============================================================

ALTER TABLE public.on_call_signups
  ADD COLUMN IF NOT EXISTS current_week_hours_last_checked numeric,
  ADD COLUMN IF NOT EXISTS projected_hours_if_used_last_checked numeric,
  ADD COLUMN IF NOT EXISTS would_be_ot_last_checked boolean,
  ADD COLUMN IF NOT EXISTS current_hours_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS current_hours_check_status text,
  ADD COLUMN IF NOT EXISTS current_hours_check_error text,
  ADD COLUMN IF NOT EXISTS todo_complete boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS on_call_approval_mode text,
  ADD COLUMN IF NOT EXISTS on_call_lc_custom_start text,
  ADD COLUMN IF NOT EXISTS on_call_lc_custom_end text,
  ADD COLUMN IF NOT EXISTS on_call_lc_instructions text,
  ADD COLUMN IF NOT EXISTS on_call_approved_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_on_call_used_todo
  ON public.on_call_signups(status, todo_complete, date)
  WHERE status = 'used';
