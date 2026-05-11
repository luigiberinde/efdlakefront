// app/api/vector/check-application-eligibility/route.js

import { vectorRequest } from "@/lib/vector-client";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeName(name) {
  return String(name || "").trim().toLowerCase();
}

function requiredDate(value, label = "date") {
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

function addDays(dateString, days) {
  const [y, m, d] = dateString.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function weekStartMonday(dateString) {
  const [y, m, d] = dateString.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay(); // Sunday 0, Monday 1
  const diffToMonday = day === 0 ? -6 : 1 - day;
  dt.setUTCDate(dt.getUTCDate() + diffToMonday);
  return dt.toISOString().slice(0, 10);
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

  return users
    .filter((user) => {
      const emails = Array.isArray(user.emails) ? user.emails : [];
      return emails.some((e) => normalizeEmail(e) === target);
    })
    .map(safeUser);
}

function findUsersByExactName(users, name) {
  const target = normalizeName(name);
  if (!target) return [];

  return users
    .filter((user) => {
      const fullName = normalizeName(
        user.full_name || `${user.first_name || ""} ${user.last_name || ""}`
      );
      return fullName === target;
    })
    .map(safeUser);
}

function safeShift({ dayDate, assignment, shift }) {
  return {
    day_date: dayDate,

    assignment_id: assignment.id ?? null,
    assignment_name: assignment.name ?? null,
    assignment_start: assignment.start ?? null,
    assignment_end: assignment.end ?? null,
    assignment_is_finalized: assignment.is_finalized ?? null,

    shift_id: shift.id ?? null,
    shift_start: shift.start ?? null,
    shift_end: shift.end ?? null,
    shift_length: Number(shift.length ?? 0),
    shift_real_length: Number(shift.real_length ?? shift.length ?? 0),
    break_length: Number(shift.break_length ?? 0),

    user_id: shift.user?.id ?? null,
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

async function findVectorUser({ email, name }) {
  const usersRaw = await vectorRequest("/v1/users", {
    query: { limit: 500 },
  });

  const users = Array.isArray(usersRaw) ? usersRaw : [];

  const emailMatches = email ? findUsersByEmail(users, email) : [];
  const nameMatches = name ? findUsersByExactName(users, name) : [];

  if (emailMatches.length === 1) {
    return {
      ok: true,
      user: emailMatches[0],
      matchMethod: "exact_email",
      matchConfidence: "high",
      emailMatchesFound: emailMatches.length,
      nameMatchesFound: nameMatches.length,
    };
  }

  if (emailMatches.length > 1) {
    return {
      ok: false,
      blockReason: "multiple_email_matches",
      emailMatchesFound: emailMatches.length,
      nameMatchesFound: nameMatches.length,
    };
  }

  if (nameMatches.length === 1) {
    return {
      ok: true,
      user: nameMatches[0],
      matchMethod: "exact_name_only",
      matchConfidence: "medium",
      emailMatchesFound: emailMatches.length,
      nameMatchesFound: nameMatches.length,
    };
  }

  if (nameMatches.length > 1) {
    return {
      ok: false,
      blockReason: "multiple_name_matches",
      emailMatchesFound: emailMatches.length,
      nameMatchesFound: nameMatches.length,
    };
  }

  return {
    ok: false,
    blockReason: "no_vector_user_match",
    emailMatchesFound: emailMatches.length,
    nameMatchesFound: nameMatches.length,
  };
}

async function getScheduleRows(startDate, endDateExclusive) {
  const schedule = await vectorRequest("/v1/schedule", {
    query: {
      start: `${startDate} 00:00:00`,
      end: `${endDateExclusive} 00:00:00`,
    },
  });

  return flattenSchedule(schedule);
}

export async function POST(request) {
  try {
    const body = await request.json();

    const email = normalizeEmail(body.email);
    const name = String(body.name || "").trim();
    const shiftDate = requiredDate(body.shiftDate || body.date, "shiftDate/date");

    const postedShiftLength = Number(body.postedShiftLength ?? body.shiftLength ?? 0);

    if (!email && !name) {
      throw new Error("Provide applicant email or name.");
    }

    if (!postedShiftLength || postedShiftLength <= 0) {
      throw new Error("postedShiftLength must be provided and greater than 0.");
    }

    const userResult = await findVectorUser({ email, name });

    if (!userResult.ok) {
      return Response.json({
        ok: true,
        allowed: false,
        decision: "block",
        blockReason: userResult.blockReason,
        message:
          "Vector could not confidently match this applicant. Double-check the name/email or contact an LC.",
        searched: { email, name, shiftDate },
        emailMatchesFound: userResult.emailMatchesFound,
        nameMatchesFound: userResult.nameMatchesFound,
      });
    }

    const vectorUser = userResult.user;

    // Same-day check
    const nextDate = nextDay(shiftDate);
    const sameDayRows = await getScheduleRows(shiftDate, nextDate);

    const sameDayShifts = sameDayRows.filter(
      (shift) => Number(shift.user_id) === Number(vectorUser.user_id)
    );

    if (sameDayShifts.length > 0) {
      return Response.json({
        ok: true,
        allowed: false,
        decision: "block",
        blockReason: "already_scheduled_on_shift_date",
        message:
          "Vector shows this applicant is already scheduled on this date, so they cannot apply for this shift. Contact an LC if this is incorrect.",
        searched: { email, name, shiftDate },
        vectorUser,
        matchMethod: userResult.matchMethod,
        matchConfidence: userResult.matchConfidence,
        sameDayShifts,
      });
    }

    // Monday 00:00 through next Monday 00:00.
    const weekStart = weekStartMonday(shiftDate);
    const weekEnd = addDays(weekStart, 7);

    const weekRows = await getScheduleRows(weekStart, weekEnd);

    const weekShifts = weekRows.filter(
      (shift) => Number(shift.user_id) === Number(vectorUser.user_id)
    );

    const vectorWeekHours = weekShifts.reduce(
      (sum, shift) => sum + Number(shift.shift_real_length || shift.shift_length || 0),
      0
    );

    const projectedAfterApproval = vectorWeekHours + postedShiftLength;
    const wouldBeOT = projectedAfterApproval > 40;

    return Response.json({
      ok: true,
      allowed: true,
      decision: "allow",
      blockReason: null,
      message: wouldBeOT
        ? "Applicant is not scheduled on this date, but projected Vector hours exceed 40."
        : "Vector confirms this applicant is not scheduled on this date.",
      searched: { email, name, shiftDate },
      vectorUser,
      matchMethod: userResult.matchMethod,
      matchConfidence: userResult.matchConfidence,

      sameDay: {
        alreadyScheduled: false,
        shifts: [],
      },

      week: {
        weekStart,
        weekEndExclusive: weekEnd,
        vectorWeekHours,
        postedShiftLength,
        projectedAfterApproval,
        wouldBeOT,
        shifts: weekShifts,
      },
    });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        allowed: false,
        decision: "error",
        error: err.message || "Vector application eligibility check failed.",
        details: err.response || null,
      },
      { status: err.status || 500 }
    );
  }
}
