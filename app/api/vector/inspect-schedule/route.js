// app/api/vector/inspect-schedule/route.js

import { vectorRequest, requireVectorDebugAccess } from "@/lib/vector-client";
import { addDays, flattenSchedule, findUserShifts, findVectorUser } from "@/lib/vector-core";

function normalizeDateTime(value, label, fallbackTime = "00:00:00") {
  if (!value) throw new Error(`${label} is required.`);

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value} ${fallbackTime}`;
  }

  const plusFixed = value.replace(/\+/g, " ");
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(plusFixed)) {
    return plusFixed;
  }

  throw new Error(`${label} must be YYYY-MM-DD or YYYY-MM-DD hh:mm:ss.`);
}

function dateOnly(value) {
  return String(value || "").slice(0, 10);
}

export async function GET(request) {
  try {
    requireVectorDebugAccess(request);

    const url = new URL(request.url);
    const rawStart = url.searchParams.get("start");
    const rawEnd = url.searchParams.get("end");
    const userIdParam = url.searchParams.get("userId");
    const email = url.searchParams.get("email") || "";
    const name = url.searchParams.get("name") || "";

    if (!rawStart) throw new Error("start is required.");

    const start = normalizeDateTime(rawStart, "start", "00:00:00");
    const startDate = dateOnly(start);
    const end = rawEnd
      ? normalizeDateTime(rawEnd, "end", "00:00:00")
      : `${addDays(startDate, 1)} 00:00:00`;
    const endDate = dateOnly(end);

    const schedule = await vectorRequest("/v1/schedule", {
      query: { start, end },
    });

    const allRows = flattenSchedule(schedule);
    const rows = allRows.filter(r => r.day_date >= startDate && r.day_date < endDate);

    let vectorUser = null;
    if (email || name) {
      const userResult = await findVectorUser({ email, name, publicStrictEmail: Boolean(email) });
      if (userResult.ok) vectorUser = userResult.user;
    }

    const userId = userIdParam ? Number(userIdParam) : null;
    const matches = vectorUser
      ? findUserShifts(rows, vectorUser)
      : rows.filter((shift) => {
          if (userId && Number(shift.user_id) === userId) return true;
          if (name && String(shift.user_name || "").trim().toLowerCase() === String(name).trim().toLowerCase()) return true;
          return false;
        });

    return Response.json({
      ok: true,
      endpoint: "/v1/schedule",
      vectorQuery: { start, end },
      totals: {
        rawShiftsFound: allRows.length,
        shiftsFoundInDateRange: rows.length,
        matchesFound: matches.length,
      },
      searched: {
        userId: userId || null,
        email: email || null,
        name: name || null,
        vectorUser,
      },
      matches,
      sampleShifts: rows.slice(0, 25),
      note: "Sanitized diagnostic. Uses the same normalized schedule parsing as production validation.",
    });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        error: err.message || "Vector schedule inspection failed.",
        details: err.response || null,
      },
      { status: err.status || 500 }
    );
  }
}
