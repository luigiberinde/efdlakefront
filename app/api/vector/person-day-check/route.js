// app/api/vector/person-day-check/route.js

import {
  vectorRequest,
  requireVectorDebugAccess,
  findPersonMentions,
} from "@/lib/vector-client";

function requiredDate(value, label) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be YYYY-MM-DD.`);
  }
  return value;
}

function nextDay(dateString) {
  const [y, m, d] = dateString.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

function flattenScheduleMatches(mentions) {
  return mentions.map((m, index) => ({
    index,
    path: m.path,
    emailHit: m.emailHit,
    nameHit: m.nameHit,
    keys: m.keys,
  }));
}

export async function GET(request) {
  try {
    requireVectorDebugAccess(request);

    const url = new URL(request.url);
    const date = requiredDate(url.searchParams.get("date"), "date");
    const email = url.searchParams.get("email") || "";
    const name = url.searchParams.get("name") || "";

    if (!email && !name) {
      throw new Error("Provide email or name.");
    }

    const start = `${date} 00:00:00`;
    const end = `${nextDay(date)} 00:00:00`;

    const schedule = await vectorRequest("/v1/schedule", {
      query: { start, end },
    });

    const mentions = findPersonMentions(schedule, { email, name });
    const flattened = flattenScheduleMatches(mentions);

    return Response.json({
      ok: true,
      date,
      vectorQuery: { start, end },
      searched: { email: email || null, name: name || null },
      workingThatDay: mentions.length > 0,
      matchesFound: mentions.length,
      matches: flattened,
      provisionalDecision:
        mentions.length > 0
          ? "Vector appears to show this person on the schedule for this date."
          : "Vector did not find this person on this date.",
      note: "This is provisional until we map Vector's exact schedule JSON structure.",
    });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        error: err.message || "Vector person/day check failed.",
        details: err.response || null,
      },
      { status: err.status || 500 }
    );
  }
}