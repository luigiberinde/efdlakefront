-- ============================================================
-- PATCH 003 — Expiration timing + closed/history date sorting
-- ============================================================
-- 1) Shifts expire only when their shift date is before today's
--    America/Chicago date. A May 5 shift expires starting May 6.
-- 2) Closed/history "Shift date" sorting returns upcoming/today
--    dates first, then past dates at the end.
-- ============================================================

CREATE OR REPLACE FUNCTION expire_past_shifts()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
BEGIN
  UPDATE shifts
  SET status = 'expired', expired_at = now()
  WHERE status = 'open'
    AND date < v_today;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN json_build_object('success', true, 'expired_count', v_count, 'today_chicago', v_today);
END;
$$;

REVOKE EXECUTE ON FUNCTION expire_past_shifts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION expire_past_shifts() TO service_role;

CREATE OR REPLACE FUNCTION get_closed_shifts_by_shift_date(
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
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
BEGIN
  SELECT count(*) INTO v_total
  FROM shifts s
  WHERE s.status IN ('taken', 'expired')
    AND (p_date IS NULL OR s.date = p_date);

  SELECT COALESCE(json_agg(row_to_json(sub)), '[]'::json)
  INTO v_shifts
  FROM (
    SELECT s.*
    FROM shifts s
    WHERE s.status IN ('taken', 'expired')
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

  RETURN json_build_object('shifts', v_shifts, 'total', v_total, 'today_chicago', v_today);
END;
$$;

GRANT EXECUTE ON FUNCTION get_closed_shifts_by_shift_date(date, int, int) TO anon, authenticated;
