# Gmail email integration patch

Files in this patch:

- `lib/gmail.js` — server-only Gmail API helper using OAuth refresh tokens
- `app/api/email/oauth/start/route.js` — LC-only route that starts Google OAuth
- `app/api/email/oauth/callback/route.js` — callback that displays the refresh token
- `app/api/email/test/route.js` — LC-only test route that sends a test email
- `app/api/approve/route.js` — updated so approval emails send immediately when EMAIL_ENABLED=true
- `.env.example` — updated env var template

## Local setup

Add these to `.env.local`:

```bash
EMAIL_ENABLED=true
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:3000/api/email/oauth/callback
GMAIL_SENDER_EMAIL=lberinde@cityofevanston.org
GMAIL_REFRESH_TOKEN=
```

Restart:

```bash
npm run dev
```

Log in as LC locally, then visit:

```text
http://localhost:3000/api/email/oauth/start
```

Authorize the City Gmail account. The callback page will show a refresh token. Copy it into `.env.local` as `GMAIL_REFRESH_TOKEN`.

Restart again:

```bash
npm run dev
```

Test:

```text
http://localhost:3000/api/email/test?to=lberinde@cityofevanston.org
```

If successful, approval emails will be sent by Gmail when LCs approve applications.

## Vercel setup

Add the same email variables to Vercel Production, except:

```bash
GOOGLE_REDIRECT_URI=https://YOUR-LIVE-DOMAIN/api/email/oauth/callback
```

Then redeploy.

Keep `VECTOR_SYNC_WRITES_ENABLED=false`; this patch only sends emails, not Vector writes.
