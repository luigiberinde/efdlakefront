import { exchangeCodeForTokens } from "@/lib/gmail";

function htmlEscape(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const error = url.searchParams.get("error");
    const code = url.searchParams.get("code");

    if (error) {
      return new Response(`<h1>Google OAuth error</h1><pre>${htmlEscape(error)}</pre>`, {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (!code) {
      return new Response("<h1>Missing OAuth code</h1>", {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    const tokens = await exchangeCodeForTokens(code);
    const refreshToken = tokens.refresh_token || "";

    const body = refreshToken
      ? `
        <h1>Gmail OAuth worked</h1>
        <p>Copy this refresh token into <code>GMAIL_REFRESH_TOKEN</code> in <code>.env.local</code> and Vercel.</p>
        <textarea style="width:100%;height:160px;">${htmlEscape(refreshToken)}</textarea>
        <p>Then restart the dev server and test <code>/api/email/test</code>.</p>
      `
      : `
        <h1>OAuth returned no refresh token</h1>
        <p>Go back to <code>/api/email/oauth/start</code>. If it still happens, remove this app from your Google Account's third-party access page and try again, or keep <code>prompt=consent</code>.</p>
        <pre>${htmlEscape(JSON.stringify(tokens, null, 2))}</pre>
      `;

    return new Response(body, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (err) {
    return new Response(`<h1>OAuth callback failed</h1><pre>${htmlEscape(err.message)}</pre>`, {
      status: 500,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
}
