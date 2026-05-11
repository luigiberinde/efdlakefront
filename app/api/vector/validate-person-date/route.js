// app/api/vector/validate-person-date/route.js

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
    assignment_href: assignment.href ?? null,
    assignment_name: assignment.name ?? null,
    assignment_start: assignment.start ?? null,
    assignment_end: assignment.end ?? null,
    assignment_is_finalized: assignment.is_finalized ?? null,

    shift_id: shift.id ?? null,
    shift_href: shift.href ?? null,
    shift_start: shift.start ?? null,
    shift_end: shift.end ?? null,
    shift_length: Number(shift.length ?? 0),
    shift_real_length: Number(shift.real_length ?? shift.length ?? 0),
    break_length: Number(shift.break_length ?? 0),

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

export async function POST(request) {
  try {
    const body = await request.json();

    const email = normalizeEmail(body.email);
    const name = String(body.name || "").trim();
    const date = requiredDate(body.date);

    if (!email && !name) {
      throw new Error("Provide email or name.");
    }

    const usersRaw = await vectorRequest("/v1/users", {
      query: { limit: 500 },
    });

    const users = Array.isArray(usersRaw) ? usersRaw : [];

    const emailMatches = email ? findUsersByEmail(users, email) : [];
    const nameMatches = name ? findUsersByExactName(users, name) : [];

    let matchedUser = null;
    let matchMethod = null;
    let matchConfidence = "none";
    let blockReason = null;

    if (emailMatches.length === 1) {
      matchedUser = emailMatches[0];
      matchMethod = "exact_email";
      matchConfidence = "high";
    } else if (emailMatches.length > 1) {
      blockReason = "multiple_email_matches";
    } else if (nameMatches.length === 1) {
      matchedUser = nameMatches[0];
      matchMethod = "exact_name_only";
      matchConfidence = "medium";
    } else if (nameMatches.length > 1) {
      blockReason = "multiple_name_matches";
    } else {
      blockReason = "no_vector_user_match";
    }

    if (!matchedUser) {
      return Response.json({
        ok: true,
        allowed: false,
        workingThatDay: false,
        decision: "block",
        blockReason,
        message:
          "Vector could not confidently match this person. Double-check the name/email or contact an LC.",
        searched: { email, name, date },
        emailMatchesFound: emailMatches.length,
        nameMatchesFound: nameMatches.length,
      });
    }

    const start = `${date} 00:00:00`;
    const end = `${nextDay(date)} 00:00:00`;

    const schedule = await vectorRequest("/v1/schedule", {
      query: { start, end },
    });

    const allShifts = flattenSchedule(schedule);

    const matchedShifts = allShifts.filter(
      (shift) => Number(shift.user_id) === Number(matchedUser.user_id)
    );

    const workingThatDay = matchedShifts.length > 0;

    return Response.json({
      ok: true,
      allowed: workingThatDay,
      decision: workingThatDay ? "allow" : "block",
      blockReason: workingThatDay ? null : "not_scheduled_on_date",
      message: workingThatDay
        ? "Vector confirms this person is scheduled on this date."
        : "Vector does not show this person scheduled on this date. Double-check the name, email, and date, or contact an LC.",
      searched: { email, name, date },
      vectorUser: matchedUser,
      matchMethod,
      matchConfidence,
      vectorQuery: { start, end },
      workingThatDay,
      shiftsFoundForPerson: matchedShifts.length,
      shifts: matchedShifts,
      totalScheduleShiftsOnDate: allShifts.length,
    });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        allowed: false,
        decision: "error",
        error: err.message || "Vector validation failed.",
        details: err.response || null,
      },
      { status: err.status || 500 }
    );
  }
}
