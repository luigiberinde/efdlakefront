-- Prevent duplicate active On-Call signups for the same person/date when the existing data allows it.
-- This is intentionally non-destructive: if duplicates already exist, it leaves the index uncreated
-- and the API still blocks new duplicates.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM on_call_signups
    WHERE status = 'active'
    GROUP BY normalized_email, date
    HAVING COUNT(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_on_call_email_date
      ON on_call_signups (normalized_email, date)
      WHERE status = 'active';
  ELSE
    RAISE NOTICE 'Skipped idx_unique_active_on_call_email_date because duplicate active On-Call rows already exist. Remove/resolve duplicates first, then rerun this migration.';
  END IF;
END $$;
