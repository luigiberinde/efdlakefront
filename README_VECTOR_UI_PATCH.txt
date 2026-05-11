Vector UI integration patch

Files to copy into your lakefront-shift-swap project:

1. components/ShiftBoard.js -> replace existing components/ShiftBoard.js
2. lib/vector-core.js -> add new file at lib/vector-core.js
3. app/api/post-shift/route.js -> add new API route
4. app/api/apply-shift/route.js -> add new API route
5. app/api/vector/approval-preflight/route.js -> add new API route
6. supabase/002_vector_integration.sql -> run in Supabase SQL editor before testing the UI

What this patch does:
- Public shift posts now go through /api/post-shift.
- Public posters must be confirmed by Vector unless LC override is checked.
- LCs can create open shifts without a poster Vector shift, but must enter shift length.
- Swap posts validate both sides in Vector.
- Preferred applicants are checked and warnings are LC-visible, not public.
- Applications go through /api/apply-shift and no longer ask for manual weekly hours.
- Applicants are blocked if Vector finds them already scheduled on that date.
- OT is allowed but flagged.
- LC Review shows Vector projected hours/warnings.
- Approval confirmation runs a Vector preflight and keeps Vector sync disabled for now.

After copying:
1. Run the SQL in Supabase: supabase/002_vector_integration.sql
2. Restart local dev server: npm run dev
3. Test posting with a real Vector scheduled date.
4. Test LC override posting.
5. Test applying on a non-working date and a working date.

Commit only after testing.
