// lib/vector-client.js
// Server-only Vector/CrewSense API helper.
// Do not import this from client components.

const DEFAULT_BASE_URL = "https://api.crewsense.com";

let cachedToken = null;
let cachedTokenExpiresAtMs = 0;

function getVectorConfig() {
  const enabled = process.env.VECTOR_ENABLED === "true";
  const baseUrl = (process.env.VECTOR_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const clientId = process.env.VECTOR_CLIENT_ID;
  const clientSecret = process.env.VECTOR_CLIENT_SECRET;

  if (!enabled) {
    return { enabled: false, baseUrl, clientId, clientSecret };
  }

  if (!clientId || !clientSecret) {
    throw new Error("Vector is enabled, but VECTOR_CLIENT_ID or VECTOR_CLIENT_SECRET is missing.");
  }

  return { enabled, baseUrl, clientId, clientSecret };
}

export async function getVectorAccessToken({ forceRefresh = false } = {}) {
  const { enabled, baseUrl, clientId, clientSecret } = getVectorConfig();

  if (!enabled) {
    throw new Error("Vector integration is disabled. Set VECTOR_ENABLED=true.");
  }

  const now = Date.now();

  // Refresh 60 seconds before expiration to avoid edge-of-token-death drama.
  if (!forceRefresh && cachedToken && cachedTokenExpiresAtMs - 60_000 > now) {
    return cachedToken;
  }

  const body = new URLSearchParams();
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);
  body.set("grant_type", "client_credentials");

  const res = await fetch(`${baseUrl}/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });

  const text = await res.text();
  let json;

  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Vector token response was not JSON. Status ${res.status}: ${text.slice(0, 500)}`);
  }

  if (!res.ok || !json.access_token) {
    throw new Error(`Vector token request failed. Status ${res.status}: ${JSON.stringify(json).slice(0, 800)}`);
  }

  cachedToken = json.access_token;

  if (json.expires) {
    cachedTokenExpiresAtMs = Number(json.expires) * 1000;
  } else if (json.expires_in) {
    cachedTokenExpiresAtMs = now + Number(json.expires_in) * 1000;
  } else {
    cachedTokenExpiresAtMs = now + 60 * 60 * 1000;
  }

  return cachedToken;
}

export async function vectorRequest(path, { method = "GET", query = {}, body = null, forceTokenRefresh = false } = {}) {
  const { enabled, baseUrl } = getVectorConfig();

  if (!enabled) {
    throw new Error("Vector integration is disabled. Set VECTOR_ENABLED=true.");
  }

  const token = await getVectorAccessToken({ forceRefresh: forceTokenRefresh });

  const url = new URL(`${baseUrl}${path.startsWith("/") ? path : `/${path}`}`);

  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : null,
    cache: "no-store",
  });

  const text = await res.text();
  let json;

  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { rawText: text };
  }

  if (res.status === 401 && !forceTokenRefresh) {
    cachedToken = null;
    cachedTokenExpiresAtMs = 0;
    return vectorRequest(path, { method, query, body, forceTokenRefresh: true });
  }

  if (!res.ok) {
    const error = new Error(`Vector request failed: ${method} ${url.pathname} ${res.status}`);
    error.status = res.status;
    error.response = json;
    throw error;
  }

  return json;
}

export function requireVectorDebugAccess(request) {
  const expected = process.env.VECTOR_DEBUG_SECRET;

  if (!expected) {
    throw new Error("VECTOR_DEBUG_SECRET is missing. Add it to .env.local.");
  }

  const url = new URL(request.url);
  const provided =
    request.headers.get("x-vector-debug-secret") ||
    url.searchParams.get("debugSecret");

  if (provided !== expected) {
    const error = new Error("Unauthorized Vector diagnostic request.");
    error.status = 401;
    throw error;
  }
}

export function summarizeJson(value, maxChars = 80_000) {
  const seen = new WeakSet();

  const json = JSON.stringify(
    value,
    (key, val) => {
      if (typeof val === "object" && val !== null) {
        if (seen.has(val)) return "[Circular]";
        seen.add(val);
      }
      return val;
    },
    2
  );

  if (json.length <= maxChars) {
    return { truncated: false, text: json };
  }

  return {
    truncated: true,
    text: json.slice(0, maxChars),
  };
}

export function findPersonMentions(data, { email, name }) {
  const needleEmail = (email || "").trim().toLowerCase();
  const needleName = (name || "").trim().toLowerCase();

  const matches = [];

  function walk(node, path = []) {
    if (!node || typeof node !== "object") return;

    const values = Object.entries(node)
      .filter(([, v]) => typeof v === "string" || typeof v === "number")
      .map(([k, v]) => [k, String(v)]);

    const haystack = values.map(([, v]) => v.toLowerCase()).join(" | ");

    const emailHit = needleEmail && haystack.includes(needleEmail);
    const nameHit = needleName && haystack.includes(needleName);

    if (emailHit || nameHit) {
      matches.push({
        path: path.join("."),
        emailHit,
        nameHit,
        keys: values.slice(0, 30).map(([k, v]) => ({ key: k, value: v })),
        objectPreview: node,
      });
    }

    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, [...path, `[${index}]`]));
    } else {
      Object.entries(node).forEach(([key, value]) => {
        if (value && typeof value === "object") {
          walk(value, [...path, key]);
        }
      });
    }
  }

  walk(data, ["root"]);

  return matches.slice(0, 50);
}
