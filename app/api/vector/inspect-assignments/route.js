import { vectorRequest, requireVectorDebugAccess } from "@/lib/vector-client";

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

function nextDayAtMidnight(dateString) {
  const [y, m, d] = dateString.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10) + " 00:00:00";
}

function getDays(schedule) {
  const days = schedule?.days;

  if (Array.isArray(days)) {
    return days.map((day, index) => ({
      key: String(day?.date || day?.day || index),
      value: day,
    }));
  }

  if (days && typeof days === "object") {
    return Object.entries(days).map(([key, value]) => ({ key, value }));
  }

  return [];
}

function summarizeValue(value) {
  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      sampleKeys:
        value.length && value[0] && typeof value[0] === "object"
          ? Object.keys(value[0])
          : [],
      sample: value.slice(0, 2),
    };
  }

  if (value && typeof value === "object") {
    return {
      type: "object",
      keys: Object.keys(value),
      sample: value,
    };
  }

  return {
    type: typeof value,
    value,
  };
}

function compactAssignment(dayKey, assignment) {
  const keys = Object.keys(assignment || {});
  const fields = {};

  for (const key of keys) {
    fields[key] = summarizeValue(assignment[key]);
  }

  return {
    dayKey,
    id: assignment?.id ?? null,
    href: assignment?.href ?? null,
    name: assignment?.name ?? null,
    date: assignment?.date ?? null,
    start: assignment?.start ?? null,
    end: assignment?.end ?? null,
    is_finalized: assignment?.is_finalized ?? null,
    keys,
    fields,
  };
}

export async function GET(request) {
  try {
    requireVectorDebugAccess(request);

    const url = new URL(request.url);

    const rawStart = url.searchParams.get("start");
    const rawEnd = url.searchParams.get("end");
    const assignmentFilter = String(url.searchParams.get("assignment") || "").toLowerCase();
    const personFilter = String(url.searchParams.get("person") || "").toLowerCase();

    if (!rawStart) throw new Error("start is required.");

    const start = normalizeDateTime(rawStart, "start", "00:00:00");
    const end = rawEnd
      ? normalizeDateTime(rawEnd, "end", "00:00:00")
      : /^\d{4}-\d{2}-\d{2}$/.test(rawStart)
        ? nextDayAtMidnight(rawStart)
        : null;

    if (!end) throw new Error("end is required when start is a datetime.");

    const schedule = await vectorRequest("/v1/schedule", {
      query: { start, end },
    });

    const allAssignments = [];

    for (const { key: dayKey, value: day } of getDays(schedule)) {
      const assignments = Array.isArray(day?.assignments) ? day.assignments : [];

      for (const assignment of assignments) {
        const text = JSON.stringify(assignment || {}).toLowerCase();

        if (
          assignmentFilter &&
          !String(assignment?.name || "").toLowerCase().includes(assignmentFilter)
        ) {
          continue;
        }

        if (personFilter && !text.includes(personFilter)) {
          continue;
        }

        allAssignments.push(compactAssignment(dayKey, assignment));
      }
    }

    return Response.json({
      ok: true,
      endpoint: "/v1/schedule",
      vectorQuery: { start, end },
      filters: {
        assignment: assignmentFilter || null,
        person: personFilter || null,
      },
      assignmentsFound: allAssignments.length,
      assignments: allAssignments,
      note: "Local diagnostic. Shows assignment keys/fields so we can parse CrewSense lifeguard rotation assignments correctly.",
    });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        error: err.message || "Assignment inspection failed.",
        details: err.response || null,
      },
      { status: err.status || 500 }
    );
  }
}
