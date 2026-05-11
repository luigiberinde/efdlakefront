import { vectorRequest } from "@/lib/vector-client";

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function normalizeName(name) {
  return String(name || "").trim().replace(/\s+/g, " ");
}

export function requiredDate(value, label = "date") {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be YYYY-MM-DD.`);
  }
  return value;
}

export function addDays(dateString, days) {
  const [y, m, d] = dateString.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function weekStartMonday(dateString) {
  const [y, m, d] = dateString.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  dt.setUTCDate(dt.getUTCDate() + diffToMonday);
  return dt.toISOString().slice(0, 10);
}

export function safeUser(user) {
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
  return users.filter(user => {
    const emails = Array.isArray(user.emails) ? user.emails : [];
    return emails.some(e => normalizeEmail(e) === target);
  }).map(safeUser);
}

function findUsersByExactName(users, name) {
  const target = normalizeName(name).toLowerCase();
  if (!target) return [];
  return users.filter(user => {
    const fullName = normalizeName(user.full_name || `${user.first_name || ""} ${user.last_name || ""}`).toLowerCase();
    return fullName === target;
  }).map(safeUser);
}

export async function getVectorUsers() {
  const usersRaw = await vectorRequest("/v1/users", { query: { limit: 500 } });
  return Array.isArray(usersRaw) ? usersRaw : [];
}

export async function findVectorUser({ email, name, publicStrictEmail = true }) {
  const users = await getVectorUsers();
  const normalizedEmail = normalizeEmail(email);
  const normalizedName = normalizeName(name);
  const emailMatches = normalizedEmail ? findUsersByEmail(users, normalizedEmail) : [];
  const nameMatches = normalizedName ? findUsersByExactName(users, normalizedName) : [];

  if (emailMatches.length === 1) {
    return { ok: true, user: emailMatches[0], matchMethod: "exact_email", matchConfidence: "high", emailMatchesFound: emailMatches.length, nameMatchesFound: nameMatches.length };
  }
  if (emailMatches.length > 1) {
    return { ok: false, blockReason: "multiple_email_matches", emailMatchesFound: emailMatches.length, nameMatchesFound: nameMatches.length };
  }
  if (publicStrictEmail && normalizedEmail) {
    return { ok: false, blockReason: "no_vector_email_match", emailMatchesFound: emailMatches.length, nameMatchesFound: nameMatches.length };
  }
  if (nameMatches.length === 1) {
    return { ok: true, user: nameMatches[0], matchMethod: "exact_name_only", matchConfidence: "medium", emailMatchesFound: emailMatches.length, nameMatchesFound: nameMatches.length };
  }
  if (nameMatches.length > 1) {
    return { ok: false, blockReason: "multiple_name_matches", emailMatchesFound: emailMatches.length, nameMatchesFound: nameMatches.length };
  }
  return { ok: false, blockReason: "no_vector_user_match", emailMatchesFound: emailMatches.length, nameMatchesFound: nameMatches.length };
}

export function safeShift({ dayDate, assignment, shift }) {
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
    group_labels: Array.isArray(shift.groups) ? shift.groups.map(g => g.label).filter(Boolean) : [],
  };
}

export function flattenSchedule(schedule) {
  const rows = [];
  const days = schedule?.days || {};
  Object.entries(days).forEach(([dayDate, day]) => {
    const assignments = Array.isArray(day.assignments) ? day.assignments : [];
    assignments.forEach(assignment => {
      const shifts = Array.isArray(assignment.shifts) ? assignment.shifts : [];
      shifts.forEach(shift => rows.push(safeShift({ dayDate, assignment, shift })));
    });
  });
  return rows;
}

export async function getScheduleRows(startDate, endDateExclusive) {
  const schedule = await vectorRequest("/v1/schedule", {
    query: { start: `${startDate} 00:00:00`, end: `${endDateExclusive} 00:00:00` },
  });
  const rows = flattenSchedule(schedule);
  // Belt + suspenders: keep only intended [start, end) day rows.
  return rows.filter(r => r.day_date >= startDate && r.day_date < endDateExclusive);
}

export async function validatePersonDate({ email, name, date, publicStrictEmail = true }) {
  requiredDate(date);
  const userResult = await findVectorUser({ email, name, publicStrictEmail });
  if (!userResult.ok) {
    return {
      ok: true,
      allowed: false,
      workingThatDay: false,
      decision: "block",
      blockReason: userResult.blockReason,
      message: "Vector could not confidently match this person. Double-check the name/email or contact an LC.",
      emailMatchesFound: userResult.emailMatchesFound,
      nameMatchesFound: userResult.nameMatchesFound,
    };
  }
  const start = date;
  const end = addDays(date, 1);
  const rows = await getScheduleRows(start, end);
  const shifts = rows.filter(shift => Number(shift.user_id) === Number(userResult.user.user_id));
  return {
    ok: true,
    allowed: shifts.length > 0,
    decision: shifts.length > 0 ? "allow" : "block",
    blockReason: shifts.length > 0 ? null : "not_scheduled_on_date",
    message: shifts.length > 0
      ? "Vector confirms this person is scheduled on this date."
      : "Vector does not show this person scheduled on this date. Double-check the name, email, and date, or contact an LC.",
    vectorUser: userResult.user,
    matchMethod: userResult.matchMethod,
    matchConfidence: userResult.matchConfidence,
    vectorQuery: { start: `${start} 00:00:00`, end: `${end} 00:00:00` },
    workingThatDay: shifts.length > 0,
    shiftsFoundForPerson: shifts.length,
    shifts,
    totalScheduleShiftsOnDate: rows.length,
  };
}

export function chooseVectorShift(shifts, selectedShiftId) {
  if (!Array.isArray(shifts) || shifts.length === 0) return null;
  if (selectedShiftId) {
    return shifts.find(s => String(s.shift_id) === String(selectedShiftId)) || null;
  }
  return shifts.length === 1 ? shifts[0] : null;
}

export function vectorShiftColumns(prefix, user, shift) {
  return {
    [`${prefix}_vector_user_id`]: user?.user_id ?? null,
    [`${prefix}_vector_employee_id`]: user?.employee_id ?? null,
    [`${prefix}_vector_full_name`]: user?.full_name ?? null,
    [`${prefix}_vector_email`]: Array.isArray(user?.emails) ? user.emails[0] ?? null : null,
    [`${prefix}_vector_shift_id`]: shift?.shift_id ?? null,
    [`${prefix}_vector_assignment_id`]: shift?.assignment_id ?? null,
    [`${prefix}_vector_assignment_name`]: shift?.assignment_name ?? null,
    [`${prefix}_vector_shift_start`]: shift?.shift_start ?? null,
    [`${prefix}_vector_shift_end`]: shift?.shift_end ?? null,
    [`${prefix}_vector_shift_length`]: shift?.shift_real_length ?? shift?.shift_length ?? null,
    [`${prefix}_vector_work_type_name`]: shift?.work_type_name ?? null,
    [`${prefix}_vector_group_labels`]: shift?.group_labels ?? [],
  };
}

export async function checkApplicationEligibility({ email, name, shiftDate, postedShiftLength, publicStrictEmail = true }) {
  requiredDate(shiftDate, "shiftDate");
  const shiftLength = Number(postedShiftLength || 0);
  if (!shiftLength || shiftLength <= 0) throw new Error("postedShiftLength must be provided and greater than 0.");

  const userResult = await findVectorUser({ email, name, publicStrictEmail });
  if (!userResult.ok) {
    return {
      ok: true,
      allowed: false,
      decision: "block",
      blockReason: userResult.blockReason,
      message: "Vector could not confidently match this applicant. Double-check the name/email or contact an LC.",
      emailMatchesFound: userResult.emailMatchesFound,
      nameMatchesFound: userResult.nameMatchesFound,
    };
  }

  const nextDate = addDays(shiftDate, 1);
  const sameDayRows = await getScheduleRows(shiftDate, nextDate);
  const sameDayShifts = sameDayRows.filter(shift => Number(shift.user_id) === Number(userResult.user.user_id));
  if (sameDayShifts.length > 0) {
    return {
      ok: true,
      allowed: false,
      decision: "block",
      blockReason: "already_scheduled_on_shift_date",
      message: "Vector shows this applicant is already scheduled on this date, so they cannot apply for this shift. Contact an LC if this is incorrect.",
      vectorUser: userResult.user,
      matchMethod: userResult.matchMethod,
      matchConfidence: userResult.matchConfidence,
      sameDayShifts,
    };
  }

  const weekStart = weekStartMonday(shiftDate);
  const weekEnd = addDays(weekStart, 7);
  const weekRows = await getScheduleRows(weekStart, weekEnd);
  const weekShifts = weekRows.filter(shift => Number(shift.user_id) === Number(userResult.user.user_id));
  const vectorWeekHours = weekShifts.reduce((sum, shift) => sum + Number(shift.shift_real_length || shift.shift_length || 0), 0);
  const projectedAfterApproval = vectorWeekHours + shiftLength;
  const wouldBeOT = projectedAfterApproval > 40;

  return {
    ok: true,
    allowed: true,
    decision: "allow",
    blockReason: null,
    message: wouldBeOT
      ? "Applicant is not scheduled on this date, but projected Vector hours exceed 40."
      : "Vector confirms this applicant is not scheduled on this date.",
    vectorUser: userResult.user,
    matchMethod: userResult.matchMethod,
    matchConfidence: userResult.matchConfidence,
    sameDay: { alreadyScheduled: false, shifts: [] },
    week: { weekStart, weekEndExclusive: weekEnd, vectorWeekHours, postedShiftLength: shiftLength, projectedAfterApproval, wouldBeOT, shifts: weekShifts },
  };
}
