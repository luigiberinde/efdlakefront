# Lakefront Shift Swap

Internal shift swap system for the City of Evanston Fire Department Lakefront.

## Quick start

1. Create a free Supabase project at https://supabase.com
2. Run `supabase/001_initial.sql` in the Supabase SQL Editor
3. Enable Realtime on `shifts` and `applications` tables (Database → Replication)
4. Copy `.env.example` to `.env.local` and fill in your values
5. `npm install && npm run dev` (opens at localhost:3000)
6. Deploy to Vercel when ready

## Deploy to Vercel

1. Push to GitHub
2. Import in Vercel
3. Add all env vars from `.env.example` to Vercel project settings
4. Deploy

## Environment variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `SUPABASE_URL` | Vercel env | Supabase project URL |
| `SUPABASE_ANON_KEY` | Vercel env | Public/anon key (safe in browser) |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel env | Server-only key (never in browser) |
| `GUARD_ACCESS_PASSWORD` | Vercel env | Shared staff password |
| `LC_ACCESS_PASSWORD` | Vercel env | LC admin password |
| `SESSION_SECRET` | Vercel env | JWT signing secret (32+ random chars) |
| `EMAIL_ENABLED` | Vercel env | `false` until Gmail is configured |

## Changing passwords

Update the env var in Vercel dashboard → redeploy. Takes 30 seconds. No database changes needed.

## Data Safety

**Your code and your data live in completely separate places.**

- Code lives on Vercel. Data lives in Supabase.
- Redeploying code does NOT touch your data.
- Redeploying code does not delete data. LCs can intentionally hard-delete wrong open shifts and their applications through the app. Production history for taken/expired shifts is preserved.

**Rules this project follows:**
- Never drops, truncates, or recreates production tables
- Never includes seed scripts that overwrite real data
- Uses safe migrations only (CREATE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS)
- React state is temporary UI state only — Supabase is the source of truth
- Service role key is never exposed to the browser

**What survives a Vercel redeploy:**
- All non-deleted posted shifts ✓
- All applications tied to non-deleted shifts ✓
- All approvals/history ✓
- All notification records ✓
- To-do status ✓
- Passwords (stored as env vars, not in code) ✓

**What does NOT survive:**
- Intentionally deleted open shifts and their associated applications. This is by design for bad/wrong open posts.
- Code updates do not touch Supabase data.

## Architecture

- **Reads**: Browser → Supabase anon key (with RLS). Real-time subscriptions for live updates.
- **Posts/applications**: Browser → Supabase anon key INSERT (RLS allows).
- **LC actions** (approve/delete/mark-done): Browser → Next.js API route → verifies LC session → Supabase service_role key.
- **Auth**: Signed JWT cookies. Guard session (8hr), LC session (4hr). Middleware redirects unauthenticated requests to /login.
- **Privacy**: noindex meta, robots.txt, guard password gate. Emails/LC notes/preferred details not shown in UI without LC auth.

## Email notifications

Currently `EMAIL_ENABLED=false`. Notification records are created on every approval/deletion but marked as `skipped`.

When ready:
1. Set up Gmail API OAuth with your City email
2. Add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GMAIL_SENDER_EMAIL` to Vercel env
3. Set `EMAIL_ENABLED=true`
4. Redeploy

Fallback: Google Apps Script webhook if Gmail API is blocked by Workspace admin.
