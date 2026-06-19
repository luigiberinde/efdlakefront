-- ============================================================
-- 010 — Beach Staff portal (Gate Attendants / Office Staff)
-- Additive portal split for Lakefront vs Beach Staff shift boards.
-- Existing guard/manager rows remain portal='lakefront'.
-- ============================================================

ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS portal text NOT NULL DEFAULT 'lakefront';

ALTER TABLE public.shift_watch_requests
  ADD COLUMN IF NOT EXISTS portal text NOT NULL DEFAULT 'lakefront';

-- Widen role/type checks to include Gate Attendants + Office Staff.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shifts_type_check' AND conrelid = 'public.shifts'::regclass) THEN
    ALTER TABLE public.shifts DROP CONSTRAINT shifts_type_check;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shifts_swap_partner_type_check' AND conrelid = 'public.shifts'::regclass) THEN
    ALTER TABLE public.shifts DROP CONSTRAINT shifts_swap_partner_type_check;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shift_watch_requests_type_check' AND conrelid = 'public.shift_watch_requests'::regclass) THEN
    ALTER TABLE public.shift_watch_requests DROP CONSTRAINT shift_watch_requests_type_check;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shifts_portal_check' AND conrelid = 'public.shifts'::regclass) THEN
    ALTER TABLE public.shifts DROP CONSTRAINT shifts_portal_check;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shift_watch_requests_portal_check' AND conrelid = 'public.shift_watch_requests'::regclass) THEN
    ALTER TABLE public.shift_watch_requests DROP CONSTRAINT shift_watch_requests_portal_check;
  END IF;
END $$;

ALTER TABLE public.shifts
  ADD CONSTRAINT shifts_portal_check CHECK (portal IN ('lakefront', 'beach')),
  ADD CONSTRAINT shifts_type_check CHECK (type IN ('guard', 'manager', 'gate_attendant', 'office_staff')),
  ADD CONSTRAINT shifts_swap_partner_type_check CHECK (swap_partner_type IS NULL OR swap_partner_type IN ('guard', 'manager', 'gate_attendant', 'office_staff'));

ALTER TABLE public.shift_watch_requests
  ADD CONSTRAINT shift_watch_requests_portal_check CHECK (portal IN ('lakefront', 'beach')),
  ADD CONSTRAINT shift_watch_requests_type_check CHECK (type IN ('any', 'guard', 'manager', 'gate_attendant', 'office_staff'));

CREATE INDEX IF NOT EXISTS idx_shifts_portal_status_date ON public.shifts(portal, status, date);
CREATE INDEX IF NOT EXISTS idx_shift_watch_portal_active_range ON public.shift_watch_requests(portal, status, start_date, end_date);

-- Keep old index for compatibility, but add the portal-aware version for future duplicate checks.
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_open_shift_portal
  ON public.shifts(portal, lower(poster_email), date, type, time)
  WHERE status = 'open';

-- Portal-aware approval. Admins can only approve within their own portal.
CREATE OR REPLACE FUNCTION public.approve_application(p_shift_id bigint, p_app_id bigint, p_portal text DEFAULT 'lakefront')
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_app applications%ROWTYPE;
  v_shift shifts%ROWTYPE;
  v_now timestamptz := now();
  v_portal text := COALESCE(NULLIF(p_portal, ''), 'lakefront');
BEGIN
  SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id AND portal = v_portal FOR UPDATE;
  IF v_shift IS NULL OR v_shift.status != 'open' THEN
    RETURN json_build_object('success', false, 'error', 'This shift has already been taken or is no longer available.');
  END IF;

  SELECT * INTO v_app FROM applications WHERE id = p_app_id AND shift_id = p_shift_id;
  IF v_app IS NULL OR v_app.status != 'pending' THEN
    RETURN json_build_object('success', false, 'error', 'This application is no longer available.');
  END IF;

  UPDATE shifts SET status = 'taken', taken_by_name = v_app.applicant_name,
    taken_by_email = v_app.applicant_email, approved_at = v_now, todo_complete = false
  WHERE id = p_shift_id AND portal = v_portal;

  UPDATE applications SET status = 'approved', approved_at = v_now WHERE id = p_app_id;

  UPDATE applications SET status = 'declined'
  WHERE shift_id = p_shift_id AND id != p_app_id AND status = 'pending';

  WITH same_day AS (SELECT id FROM shifts WHERE date = v_shift.date AND portal = v_portal AND id != p_shift_id)
  UPDATE applications SET status = 'declined'
  WHERE applicant_email = v_app.applicant_email AND status = 'pending'
    AND shift_id IN (SELECT id FROM same_day);

  RETURN json_build_object('success', true,
    'approved_name', v_app.applicant_name, 'approved_email', v_app.applicant_email,
    'poster_name', v_shift.poster_name, 'poster_email', v_shift.poster_email,
    'shift_date', v_shift.date, 'shift_type', v_shift.type, 'shift_time', v_shift.time,
    'portal', v_shift.portal,
    'is_swap', v_shift.is_swap,
    'swap_partner_name', v_shift.swap_partner_name, 'swap_partner_email', v_shift.swap_partner_email,
    'swap_partner_type', v_shift.swap_partner_type, 'swap_partner_time', v_shift.swap_partner_time,
    'swap_partner_date', v_shift.swap_partner_date);
END; $$;

CREATE OR REPLACE FUNCTION public.delete_open_shift(p_shift_id bigint, p_portal text DEFAULT 'lakefront')
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_shift shifts%ROWTYPE;
  v_affected json;
  v_portal text := COALESCE(NULLIF(p_portal, ''), 'lakefront');
BEGIN
  SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id AND portal = v_portal FOR UPDATE;
  IF v_shift IS NULL OR v_shift.status != 'open' THEN
    RETURN json_build_object('success', false, 'error', 'Shift is not open.');
  END IF;

  SELECT COALESCE(json_agg(json_build_object('name', applicant_name, 'email', applicant_email)), '[]'::json)
  INTO v_affected FROM applications WHERE shift_id = p_shift_id AND status = 'pending';

  DELETE FROM applications WHERE shift_id = p_shift_id;
  DELETE FROM shifts WHERE id = p_shift_id AND portal = v_portal;

  RETURN json_build_object('success', true,
    'deleted_shift', json_build_object('poster_name', v_shift.poster_name, 'type', v_shift.type, 'time', v_shift.time, 'date', v_shift.date, 'portal', v_shift.portal),
    'affected_applicants', v_affected);
END; $$;

CREATE OR REPLACE FUNCTION public.mark_todo_done(p_shift_id bigint, p_portal text DEFAULT 'lakefront')
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count int;
  v_portal text := COALESCE(NULLIF(p_portal, ''), 'lakefront');
BEGIN
  UPDATE shifts SET todo_complete = true WHERE id = p_shift_id AND portal = v_portal AND status = 'taken';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    RETURN json_build_object('success', false, 'error', 'Shift is not available.');
  END IF;
  RETURN json_build_object('success', true);
END; $$;

CREATE OR REPLACE FUNCTION public.get_lc_review_shifts(
  p_date date DEFAULT NULL,
  p_limit int DEFAULT 10,
  p_offset int DEFAULT 0,
  p_portal text DEFAULT 'lakefront'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shifts json;
  v_total int;
  v_portal text := COALESCE(NULLIF(p_portal, ''), 'lakefront');
BEGIN
  SELECT count(*) INTO v_total
  FROM shifts s
  WHERE s.portal = v_portal
    AND s.status = 'open'
    AND EXISTS (SELECT 1 FROM applications a WHERE a.shift_id = s.id AND a.status = 'pending')
    AND (p_date IS NULL OR s.date = p_date);

  SELECT COALESCE(json_agg(row_to_json(sub)), '[]'::json)
  INTO v_shifts
  FROM (
    SELECT s.*, (SELECT count(*)::int FROM applications a WHERE a.shift_id = s.id AND a.status = 'pending') AS pending_count
    FROM shifts s
    WHERE s.portal = v_portal
      AND s.status = 'open'
      AND EXISTS (SELECT 1 FROM applications a WHERE a.shift_id = s.id AND a.status = 'pending')
      AND (p_date IS NULL OR s.date = p_date)
    ORDER BY s.date ASC, CASE WHEN s.time = 'early' THEN 0 ELSE 1 END ASC, s.posted_at ASC
    LIMIT p_limit
    OFFSET p_offset
  ) sub;

  RETURN json_build_object('shifts', v_shifts, 'total', v_total, 'portal', v_portal);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_closed_shifts_by_shift_date(
  p_date date DEFAULT NULL,
  p_limit int DEFAULT 10,
  p_offset int DEFAULT 0,
  p_portal text DEFAULT 'lakefront'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shifts json;
  v_total int;
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
  v_portal text := COALESCE(NULLIF(p_portal, ''), 'lakefront');
BEGIN
  SELECT count(*) INTO v_total
  FROM shifts s
  WHERE s.portal = v_portal
    AND s.status IN ('taken', 'expired')
    AND (p_date IS NULL OR s.date = p_date);

  SELECT COALESCE(json_agg(row_to_json(sub)), '[]'::json)
  INTO v_shifts
  FROM (
    SELECT s.*
    FROM shifts s
    WHERE s.portal = v_portal
      AND s.status IN ('taken', 'expired')
      AND (p_date IS NULL OR s.date = p_date)
    ORDER BY
      CASE WHEN s.date >= v_today THEN 0 ELSE 1 END ASC,
      CASE WHEN s.date >= v_today THEN s.date END ASC,
      CASE WHEN s.date < v_today THEN s.date END DESC,
      CASE WHEN s.time = 'early' THEN 0 ELSE 1 END ASC,
      s.posted_at ASC
    LIMIT p_limit
    OFFSET p_offset
  ) sub;

  RETURN json_build_object('shifts', v_shifts, 'total', v_total, 'today_chicago', v_today, 'portal', v_portal);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.approve_application(bigint, bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_open_shift(bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_todo_done(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_application(bigint, bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_open_shift(bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_todo_done(bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_lc_review_shifts(date, int, int, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_closed_shifts_by_shift_date(date, int, int, text) TO anon, authenticated, service_role;
