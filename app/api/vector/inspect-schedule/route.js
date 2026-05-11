// app/api/vector/inspect-schedule/route.js

import {
  vectorRequest,
  requireVectorDebugAccess,
} from "@/lib/vector-client";

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

function safeShift({ dayDate, assignment, shift }) {
  return {
    day_date: dayDate,
    assignment_id: assignment.id ?? null,
    assignment_href: assignment.href ?? null,
    assignment_name: assignment.name ?? null,
    assignment_start: assignment.start ?? null,
    assignment_end: assignment.end ?? null,
    assignment_is_finalized: assignment.is_finalized ?? null,

    shift_id: shift.id ?? null,
    shift_href: shift.href ?? null,
    shift_start: shift.start ?? null,
    shift_end: shift.end ?? null,
    shift_length: shift.length ?? null,
    shift_real_length: shift.real_length ?? null,
    break_length: shift.break_length ?? null,

    user_id: shift.user?.id ?? null,
    user_href: shift.user?.href ?? null,
    user_name: shift.user?.name ?? null,
    ts_userid: shift.user?.ts_userid ?? null,

    work_type_id: shift.work_type?.id ?? null,
    work_type_name: shift.work_type?.name ?? null,
    work_code: shift.work_type?.work_code ?? null,

    group_labels: Array.isArray(shift.groups)
      ? shift.groups.map((g) => g.label).filter(Boolean)
      : [],
  };
}

function flattenSchedule(schedule) {
  const rows = [];
  const days = schedule?.days || {};

  Object.entries(days).forEach(([dayDate, day]) => {
    const assignments = Array.isArray(day.assignments) ? day.assignments : [];

    assignments.forEach((assignment) => {
      const shifts = Array.isArray(assignment.shifts) ? assignment.shifts : [];

      shifts.forEach((shift) => {
        rows.push(safeShift({ dayDate, assignment, shift }));
      });
    });
  });

  return rows;
}

export async function GET(request) {
  try {
    requireVectorDebugAccess(request);

    const url = new URL(request.url);

    const rawStart = url.searchParams.get("start");
    const rawEnd = url.searchParams.get("end");
    const userIdParam = url.searchParams.get("userId");
    const name = String(url.searchParams.get("name") || "").trim().toLowerCase();

    if (!rawStart) throw new Error("start is required.");

    let start;
    let end;

    if (/^\d{4}-\d{2}-\d{2}$/.test(rawStart)) {
      start = normalizeDateTime(rawStart, "start", "00:00:00");
      end = rawEnd ? normalizeDateTime(rawEnd, "end", "00:00:00") : nextDayAtMidnight(rawStart);
    } else {
      start = normalizeDateTime(rawStart, "start");
      end = rawEnd ? normalizeDateTime(rawEnd, "end") : null;
      if (!end) throw new Error("end is required when start is a datetime.");
    }

    const schedule = await vectorRequest("/v1/schedule", {
      query: { start, end },
    });

    const allShifts = flattenSchedule(schedule);

    const userId = userIdParam ? Number(userIdParam) : null;

    const matches = allShifts.filter((shift) => {
      if (userId && Number(shift.user_id) === userId) return true;
      if (name && String(shift.user_name || "").trim().toLowerCase() === name) return true;
      return false;
    });

    return Response.json({
      ok: true,
      endpoint: "/v1/schedule",
      vectorQuery: { start, end },
      totals: {
        shiftsFound: allShifts.length,
        matchesFound: matches.length,
      },
      searched: {
        userId: userId || null,
        name: name || null,
      },
      matches,
      sampleShifts: allShifts.slice(0, 10),
      note: "Sanitized diagnostic. Raw schedule dump intentionally omitted. Schedule shifts do not appear to include email, so production logic should match email via /v1/users first, then schedule by user_id.",
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