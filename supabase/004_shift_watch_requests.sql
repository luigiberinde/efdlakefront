-- ============================================================
-- 004 — Shift watch requests / "Notify me"
-- Additive only. Does not touch existing shifts or applications.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.shift_watch_requests (
  id          bigserial PRIMARY KEY,
  name        text NOT NULL,
  email       text NOT NULL,
  type        text NOT NULL DEFAULT 'any' CHECK (type IN ('any', 'guard', 'manager')),
  time        text NOT NULL DEFAULT 'any' CHECK (time IN ('any', 'early', 'late')),
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shift_watch_valid_range CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_shift_watch_active_range
  ON public.shift_watch_requests(status, start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_shift_watch_email
  ON public.shift_watch_requests(lower(email));

ALTER TABLE public.shift_watch_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shift_watch_deny_all" ON public.shift_watch_requests;
DROP POLICY IF EXISTS "shift_watch_insert_public" ON public.shift_watch_requests;
DROP POLICY IF EXISTS "shift_watch_select_public" ON public.shift_watch_requests;
DROP POLICY IF EXISTS "shift_watch_update_public" ON public.shift_watch_requests;

CREATE POLICY "shift_watch_insert_public"
ON public.shift_watch_requests
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

CREATE POLICY "shift_watch_select_public"
ON public.shift_watch_requests
FOR SELECT
TO anon, authenticated
USING (true);

-- Needed so the app can unsubscribe Notify Me alerts by marking them inactive.
-- The route checks that the supplied email owns the alert before updating.
CREATE POLICY "shift_watch_update_public"
ON public.shift_watch_requests
FOR UPDATE
TO anon, authenticated
USING (true)
WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.shift_watch_requests TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.shift_watch_requests_id_seq TO anon, authenticated, service_role;
