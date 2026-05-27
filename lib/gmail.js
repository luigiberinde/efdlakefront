// lib/gmail.js
// Server-only Gmail API helper. Do not import this from client components.

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

let cachedAccessToken = null;
let cachedAccessTokenExpiresAtMs = 0;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

export function isEmailEnabled() {
  return process.env.EMAIL_ENABLED === "true";
}

export function getGmailConfig() {
  return {
    clientId: requiredEnv("GOOGLE_CLIENT_ID"),
    clientSecret: requiredEnv("GOOGLE_CLIENT_SECRET"),
    redirectUri: requiredEnv("GOOGLE_REDIRECT_URI"),
    refreshToken: process.env.GMAIL_REFRESH_TOKEN || "",
    senderEmail: requiredEnv("GMAIL_SENDER_EMAIL"),
  };
}

export function buildGoogleOAuthUrl(state = "") {
  const { clientId, redirectUri } = getGmailConfig();

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GMAIL_SEND_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  if (state) url.searchParams.set("state", state);

  return url.toString();
}

export async function exchangeCodeForTokens(code) {
  const { clientId, clientSecret, redirectUri } = getGmailConfig();

  const body = new URLSearchParams();
  body.set("code", code);
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);
  body.set("redirect_uri", redirectUri);
  body.set("grant_type", "authorization_code");

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(`Google token exchange failed: ${res.status} ${JSON.stringify(json)}`);
  }

  return json;
}

export async function getGmailAccessToken({ forceRefresh = false } = {}) {
  const { clientId, clientSecret, refreshToken } = getGmailConfig();

  if (!refreshToken) {
    throw new Error("Missing GMAIL_REFRESH_TOKEN. Authorize Gmail first.");
  }

  const now = Date.now();

  if (!forceRefresh && cachedAccessToken && cachedAccessTokenExpiresAtMs - 60_000 > now) {
    return cachedAccessToken;
  }

  const body = new URLSearchParams();
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);
  body.set("refresh_token", refreshToken);
  body.set("grant_type", "refresh_token");

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  const json = await res.json().catch(() => null);

  if (!res.ok || !json?.access_token) {
    throw new Error(`Google refresh token failed: ${res.status} ${JSON.stringify(json)}`);
  }

  cachedAccessToken = json.access_token;
  cachedAccessTokenExpiresAtMs = now + Number(json.expires_in || 3600) * 1000;

  return cachedAccessToken;
}

function encodeMimeWord(value) {
  // Enough for normal ASCII subjects/names, but safe for accents too.
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function cleanHeader(value) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim();
}

function makeMimeMessage({ to, from, subject, body, replyTo }) {
  const safeTo = cleanHeader(to);
  const safeFrom = cleanHeader(from);
  const safeSubject = cleanHeader(subject);
  const safeReplyTo = replyTo ? cleanHeader(replyTo) : "";

  if (!safeTo) throw new Error("Missing email recipient.");
  if (!safeFrom) throw new Error("Missing sender email.");

  const headers = [
    `To: ${safeTo}`,
    `From: Lakefront ShiftSwap <${safeFrom}>`,
    ...(safeReplyTo ? [`Reply-To: ${safeReplyTo}`] : []),
    `Subject: ${encodeMimeWord(safeSubject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
  ];

  return `${headers.join("\r\n")}\r\n\r\n${String(body || "")}`;
}

function base64UrlEncode(value) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function sendGmailMessage({ to, subject, body, replyTo }) {
  const { senderEmail } = getGmailConfig();
  const accessToken = await getGmailAccessToken();

  const mime = makeMimeMessage({
    to,
    from: senderEmail,
    replyTo: replyTo || senderEmail,
    subject,
    body,
  });

  const raw = base64UrlEncode(mime);

  const res = await fetch(GMAIL_SEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
    cache: "no-store",
  });

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(`Gmail send failed: ${res.status} ${JSON.stringify(json)}`);
  }

  return json;
}

export async function sendNotificationEmail(notification) {
  return sendGmailMessage({
    to: notification.recipient_email,
    subject: notification.subject,
    body: notification.body,
  });
}
