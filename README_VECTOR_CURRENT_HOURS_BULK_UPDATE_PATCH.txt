# Current Vector Hours Bulk Update Patch

This patch is intentionally narrow.

It adds persistent "last checked" current Vector hour fields to applications and updates them only when:
- an LC clicks "Check current hours" for one application, or
- an LC approves an application.

It does NOT automatically check Vector for every application on page load, so it should not slow down the website.

## Files to copy

- components/ShiftBoard.js
- app/api/vector/current-application-hours/route.js
- app/api/approve/route.js
- lib/vector-core.js
- lib/current-hours-refresh.js
- supabase/003_current_hours_refresh.sql

## Required SQL

Run `supabase/003_current_hours_refresh.sql` in Supabase SQL Editor before deploying the code.

It only uses ALTER TABLE ADD COLUMN IF NOT EXISTS and CREATE INDEX IF NOT EXISTS.
It does not delete or overwrite existing shifts/applications.

## Behavior

When current hours are checked for one pending application:
- the app fetches that applicant's current Vector week hours once,
- finds all of that applicant's pending applications in the same Monday-Sunday week,
- saves current/projected hours and last checked timestamp on each of those applications.

When an application is approved:
- approval still succeeds normally,
- then the app refreshes the approved applicant's remaining pending applications in that same week,
- Vector refresh failure does not block approval.

