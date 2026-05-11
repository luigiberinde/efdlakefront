// app/api/vector/inspect-users/route.js

import {
  vectorRequest,
  requireVectorDebugAccess,
} from "@/lib/vector-client";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function safeUser(user) {
  return {
    user_id: user.user_id ?? user.id ?? null,
    employee_id: user.employee_id ?? null,
    username: user.username ?? null,
    first_name: user.first_name ?? null,
    last_name: user.last_name ?? null,
    full_name: user.full_name ?? null,
    role: user.role ?? null,
    emails: Array.isArray(user.emails) ? user.emails : [],
  };
}

function findUsersByEmail(users, email) {
  const target = normalizeEmail(email);
  if (!target) return [];

  return users
    .filter((user) => {
      const emails = Array.isArray(user.emails) ? user.emails : [];
      return emails.some((e) => normalizeEmail(e) === target);
    })
    .map(safeUser);
}

function findUsersByName(users, name) {
  const target = String(name || "").trim().toLowerCase();
  if (!target) return [];

  return users
    .filter((user) => {
      const fullName = String(user.full_name || `${user.first_name || ""} ${user.last_name || ""}`).trim().toLowerCase();
      return fullName === target;
    })
    .map(safeUser);
}

export async function GET(request) {
  try {
    requireVectorDebugAccess(request);

    const url = new URL(request.url);
    const email = url.searchParams.get("email") || "";
    const name = url.searchParams.get("name") || "";

    const usersRaw = await vectorRequest("/v1/users", {
      query: { limit: 500 },
    });

    const users = Array.isArray(usersRaw) ? usersRaw : [];

    const emailMatches = findUsersByEmail(users, email);
    const nameMatches = findUsersByName(users, name);

    return Response.json({
      ok: true,
      endpoint: "/v1/users",
      searched: {
        email: email || null,
        name: name || null,
      },
      totalUsersReturned: users.length,
      emailMatchesFound: emailMatches.length,
      nameMatchesFound: nameMatches.length,
      emailMatches,
      nameMatches,
      decision:
        emailMatches.length === 1
          ? "exact_email_match"
          : emailMatches.length > 1
            ? "multiple_email_matches"
            : nameMatches.length === 1
              ? "exact_name_match_only"
              : nameMatches.length > 1
                ? "multiple_name_matches"
                : "no_match",
      note: "Sanitized diagnostic. Phone numbers, birth dates, hire dates, and raw user dump intentionally omitted.",
    });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        error: err.message || "Vector users inspection failed.",
        details: err.response || null,
      },
      { status: err.status || 500 }
    );
  }
}