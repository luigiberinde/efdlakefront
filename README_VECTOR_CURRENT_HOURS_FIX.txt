# Vector Current Hours Fix Patch

This patch is intentionally narrow.

It adds:
- LC-only "Check current hours" button on pending applications.
- A new API route: app/api/vector/current-application-hours/route.js
- Approval preflight now re-checks current Vector hours and displays both application-time and current/projected hours.
- Existing approved-this-week, approved-all-time, pending-this-week, prior approval warnings, OT warnings, swap behavior, delete flows, and email flows are preserved.

It does NOT add SQL, change Supabase schema, mutate active shifts, write to Vector, or auto-refresh every row on page load.
