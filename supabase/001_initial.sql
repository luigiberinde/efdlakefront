-- ============================================================
-- LAKEFRONT SHIFT SWAP — Migration 001
-- Safe on fresh or existing database. Never drops tables.
-- ============================================================

CREATE TABLE IF NOT EXISTS shifts (
  id                  bigserial PRIMARY KEY,
  poster_name         text NOT NULL,
  poster_email        text NOT NULL,
  type                text NOT NULL CHECK (type IN ('guard', 'manager')),
  time                text NOT NULL CHECK (time IN ('early', 'late')),
  date                date NOT NULL,
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'taken', 'expired')),
  is_swap             boolean NOT NULL DEFAULT false,
  swap_partner_name   text,
  swap_partner_email  text,
  swap_partner_type   text CHECK (swap_partner_type IS NULL OR swap_partner_type IN ('guard', 'manager')),
  swap_partner_time   text CHECK (swap_partner_time IS NULL OR swap_partner_time IN ('early', 'late')),
  swap_partner_date   date,
  has_preferred       boolean NOT NULL DEFAULT false,
  preferred_name      text,
  preferred_email     text,
  preferred_reason    text,
  private_lc_note     text DEFAULT '',
  taken_by_name       text,
  taken_by_email      text,
  todo_complete       boolean DEFAULT false,
  posted_at           timestamptz NOT NULL DEFAULT now(),
  approved_at         timestamptz,
  expired_at          timestamptz,
  CONSTRAINT no_swap_and_preferred CHECK (NOT (is_swap AND has_preferred)),
  CONSTRAINT swap_fields_required CHECK (
    (NOT is_swap) OR (swap_partner_name IS NOT NULL AND swap_partner_email IS NOT NULL AND swap_partner_date IS NOT NULL)
  ),
  CONSTRAINT preferred_fields_required CHECK (
    (NOT has_preferred) OR (preferred_name IS NOT NULL AND preferred_email IS NOT NULL AND preferred_reason IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS applications (
  id                  bigserial PRIMARY KEY,
  shift_id            bigint NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  applicant_name      text NOT NULL,
  applicant_email     text NOT NULL,
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  hours_after_shift   numeric NOT NULL DEFAULT 0,
  applicant_note      text DEFAULT '',
  applied_at          timestamptz NOT NULL DEFAULT now(),
  approved_at         timestamptz
);

CREATE TABLE IF NOT EXISTS notifications (
  id                      bigserial PRIMARY KEY,
  type                    text NOT NULL CHECK (type IN ('approval', 'swap_approval', 'deletion')),
  recipient_email         text NOT NULL,
  recipient_name          text NOT NULL,
  subject                 text NOT NULL,
  body                    text NOT NULL,
  status                  text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  error_message           text,
  related_shift_id        bigint REFERENCES shifts(id) ON DELETE SET NULL,
  related_application_id  bigint REFERENCES applications(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  sent_at                 timestamptz
);

-- Prevent duplicate open shifts from same poster
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_open_shift
  ON shifts(lower(poster_email), date, type, time) WHERE status = 'open';

-- Prevent duplicate pending applications
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_pending_app
  ON applications(shift_id, lower(applicant_email)) WHERE status = 'pending';

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts(status);
CREATE INDEX IF NOT EXISTS idx_shifts_date ON shifts(date);
CREATE INDEX IF NOT EXISTS idx_shifts_status_date ON shifts(status, date);
CREATE INDEX IF NOT EXISTS idx_shifts_poster_email ON shifts(poster_email);
CREATE INDEX IF NOT EXISTS idx_apps_shift_id ON applications(shift_id);
CREATE INDEX IF NOT EXISTS idx_apps_email ON applications(applicant_email);
CREATE INDEX IF NOT EXISTS idx_apps_status ON applications(status);
CREATE INDEX IF NOT EXISTS idx_apps_email_status ON applications(applicant_email, status);
CREATE INDEX IF NOT EXISTS idx_notif_status ON notifications(status);

-- ── RLS ──────────────────────────────────────────────────
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shifts_read" ON shifts;
CREATE POLICY "shifts_read" ON shifts FOR SELECT USING (true);
DROP POLICY IF EXISTS "shifts_create" ON shifts;
CREATE POLICY "shifts_create" ON shifts
FOR INSERT
WITH CHECK (
  status = 'open'
  AND taken_by_name IS NULL
  AND taken_by_email IS NULL
  AND approved_at IS NULL
  AND expired_at IS NULL
  AND COALESCE(todo_complete, false) = false
);
DROP POLICY IF EXISTS "apps_read" ON applications;
CREATE POLICY "apps_read" ON applications FOR SELECT USING (true);
DROP POLICY IF EXISTS "apps_create" ON applications;
CREATE POLICY "apps_create" ON applications
FOR INSERT
WITH CHECK (
  status = 'pending'
  AND approved_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM shifts s
    WHERE s.id = shift_id
      AND s.status = 'open'
      AND lower(s.poster_email) <> lower(applicant_email)
  )
);
DROP POLICY IF EXISTS "notif_deny" ON notifications;
CREATE POLICY "notif_deny" ON notifications FOR ALL USING (false);

-- ── FUNCTIONS ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION approve_application(p_shift_id bigint, p_app_id bigint)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_app applications%ROWTYPE;
  v_shift shifts%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id FOR UPDATE;
  IF v_shift IS NULL OR v_shift.status != 'open' THEN
    RETURN json_build_object('success', false, 'error', 'This shift has already been taken or is no longer available.');
  END IF;

  SELECT * INTO v_app FROM applications WHERE id = p_app_id AND shift_id = p_shift_id;
  IF v_app IS NULL OR v_app.status != 'pending' THEN
    RETURN json_build_object('success', false, 'error', 'This application is no longer available.');
  END IF;

  UPDATE shifts SET status = 'taken', taken_by_name = v_app.applicant_name,
    taken_by_email = v_app.applicant_email, approved_at = v_now, todo_complete = false
  WHERE id = p_shift_id;

  UPDATE applications SET status = 'approved', approved_at = v_now WHERE id = p_app_id;

  UPDATE applications SET status = 'declined'
  WHERE shift_id = p_shift_id AND id != p_app_id AND status = 'pending';

  WITH same_day AS (SELECT id FROM shifts WHERE date = v_shift.date AND id != p_shift_id)
  UPDATE applications SET status = 'declined'
  WHERE applicant_email = v_app.applicant_email AND status = 'pending'
    AND shift_id IN (SELECT id FROM same_day);

  RETURN json_build_object('success', true,
    'approved_name', v_app.applicant_name, 'approved_email', v_app.applicant_email,
    'poster_name', v_shift.poster_name, 'poster_email', v_shift.poster_email,
    'shift_date', v_shift.date, 'shift_type', v_shift.type, 'shift_time', v_shift.time,
    'is_swap', v_shift.is_swap,
    'swap_partner_name', v_shift.swap_partner_name, 'swap_partner_email', v_shift.swap_partner_email,
    'swap_partner_type', v_shift.swap_partner_type, 'swap_partner_time', v_shift.swap_partner_time,
    'swap_partner_date', v_shift.swap_partner_date);
END; $$;

CREATE OR REPLACE FUNCTION delete_open_shift(p_shift_id bigint)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_shift shifts%ROWTYPE;
  v_affected json;
BEGIN
  SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id FOR UPDATE;
  IF v_shift IS NULL OR v_shift.status != 'open' THEN
    RETURN json_build_object('success', false, 'error', 'Shift is not open.');
  END IF;

  SELECT COALESCE(json_agg(json_build_object('name', applicant_name, 'email', applicant_email)), '[]'::json)
  INTO v_affected FROM applications WHERE shift_id = p_shift_id AND status = 'pending';

  DELETE FROM applications WHERE shift_id = p_shift_id;
  DELETE FROM shifts WHERE id = p_shift_id;

  RETURN json_build_object('success', true,
    'deleted_shift', json_build_object('poster_name', v_shift.poster_name, 'type', v_shift.type, 'time', v_shift.time, 'date', v_shift.date),
    'affected_applicants', v_affected);
END; $$;

CREATE OR REPLACE FUNCTION mark_todo_done(p_shift_id bigint)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE shifts SET todo_complete = true WHERE id = p_shift_id AND status = 'taken';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    RETURN json_build_object('success', false, 'error', 'Shift is not available.');
  END IF;
  RETURN json_build_object('success', true);
END; $$;

CREATE OR REPLACE FUNCTION expire_past_shifts()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int;
BEGIN
  UPDATE shifts SET status = 'expired', expired_at = now()
  WHERE status = 'open' AND date < current_date;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN json_build_object('success', true, 'expired_count', v_count);
END; $$;

-- ── LC REVIEW QUERY ──────────────────────────────────────
-- Returns open shifts that have pending applications,
-- sorted and paginated server-side. Never misses shifts.
-- Called from browser via anon key (read-only, no new data
-- exposure beyond what shifts/applications SELECT policies
-- already allow).
-- ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_lc_review_shifts(
  p_date date DEFAULT NULL,
  p_limit int DEFAULT 10,
  p_offset int DEFAULT 0
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shifts json;
  v_total int;
BEGIN
  -- Total count of open shifts with pending applications
  SELECT count(*) INTO v_total
  FROM shifts s
  WHERE s.status = 'open'
    AND EXISTS (
      SELECT 1 FROM applications a
      WHERE a.shift_id = s.id AND a.status = 'pending'
    )
    AND (p_date IS NULL OR s.date = p_date);

  -- Paginated results with pending count per shift
  SELECT COALESCE(json_agg(row_to_json(sub)), '[]'::json)
  INTO v_shifts
  FROM (
    SELECT s.*,
      (SELECT count(*)::int FROM applications a
       WHERE a.shift_id = s.id AND a.status = 'pending'
      ) AS pending_count
    FROM shifts s
    WHERE s.status = 'open'
      AND EXISTS (
        SELECT 1 FROM applications a
        WHERE a.shift_id = s.id AND a.status = 'pending'
      )
      AND (p_date IS NULL OR s.date = p_date)
    ORDER BY
      s.date ASC,
      CASE WHEN s.time = 'early' THEN 0 ELSE 1 END ASC,
      s.posted_at ASC
    LIMIT p_limit
    OFFSET p_offset
  ) sub;

  RETURN json_build_object('shifts', v_shifts, 'total', v_total);
END;
$$;

-- ── LOCK WRITE FUNCTIONS ────────────────────────────────
-- Revoke from everyone, then grant back to service_role only.
-- service_role is used by API routes after LC session verification.
-- get_lc_review_shifts is left open (read-only, no new exposure).
-- ────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION approve_application(bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION approve_application(bigint, bigint) TO service_role;

REVOKE EXECUTE ON FUNCTION delete_open_shift(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION delete_open_shift(bigint) TO service_role;

REVOKE EXECUTE ON FUNCTION mark_todo_done(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mark_todo_done(bigint) TO service_role;

REVOKE EXECUTE ON FUNCTION expire_past_shifts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION expire_past_shifts() TO service_role;
