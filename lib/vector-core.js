import { vectorRequest } from "@/lib/vector-client";

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function normalizeName(name) {
  return String(name || "").trim().replace(/\s+/g, " ");
}

function normalizeNameKey(name) {
  return normalizeName(name).toLowerCase();
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

function dateFromDateTime(value) {
  const text = String(value || "");
  const m = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function normalizeScheduleDays(days) {
  if (!days) return [];
  if (Array.isArray(days)) {
    return days.map((day, index) => [day?.date || String(index), day]);
  }
  if (typeof days === "object") {
    return Object.entries(days);
  }
  return [];
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
  const target = normalizeNameKey(name);
  if (!target) return [];
  return users.filter(user => {
    const fullName = normalizeNameKey(user.full_name || `${user.first_name || ""} ${user.last_name || ""}`);
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

  // Public flows are email-first, but if email is missing or not loaded in Vector, LC override remains the escape hatch.
  // We do not silently fall back to name if an email was typed and did not match.
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

function idFromHref(href) {
  const text = String(href || "");
  const match = text.match(/\/(\d+)(?:$|[/?#])/);
  return match ? Number(match[1]) : null;
}

function currentVectorShiftId(shift) {
  return shift?.id ?? shift?.shift_id ?? shift?.shiftId ?? shift?.shiftID ?? shift?.uuid ?? idFromHref(shift?.href) ?? null;
}

export function safeShift({ dayDate, assignment, shift }) {
  const realDayDate =
    dayDate ||
    assignment?.date ||
    dateFromDateTime(shift?.start) ||
    dateFromDateTime(assignment?.start) ||
    null;

  return {
    day_date: realDayDate,
    assignment_id: assignment?.id ?? null,
    assignment_href: assignment?.href ?? null,
    assignment_name: assignment?.name ?? null,
    assignment_start: assignment?.start ?? null,
    assignment_end: assignment?.end ?? null,
    assignment_is_finalized: assignment?.is_finalized ?? null,
    shift_id: currentVectorShiftId(shift),
    shift_href: shift?.href ?? null,
    shift_start: shift?.start ?? null,
    shift_end: shift?.end ?? null,
    shift_length: Number(shift?.length ?? 0),
    shift_real_length: Number(shift?.real_length ?? shift?.length ?? 0),
    break_length: Number(shift?.break_length ?? 0),
    user_id: shift?.user?.id ?? null,
    user_href: shift?.user?.href ?? null,
    user_name: shift?.user?.name ?? null,
    ts_userid: shift?.user?.ts_userid ?? null,
    work_type_id: shift?.work_type?.id ?? null,
    work_type_name: shift?.work_type?.name ?? null,
    work_code: shift?.work_type?.work_code ?? null,
    group_labels: Array.isArray(shift?.groups)
      ? shift.groups.map(g => g.label).filter(Boolean)
      : Array.isArray(shift?.labels)
        ? shift.labels.map(g => g.label).filter(Boolean)
        : [],
  };
}

export function flattenSchedule(schedule) {
  const rows = [];
  const dayEntries = normalizeScheduleDays(schedule?.days);

  dayEntries.forEach(([dayKey, day]) => {
    const fallbackDayDate =
      day?.date ||
      (/^\d{4}-\d{2}-\d{2}$/.test(String(dayKey)) ? String(dayKey) : null);

    const assignments = Array.isArray(day?.assignments) ? day.assignments : [];

    assignments.forEach(assignment => {
      const assignmentDayDate =
        assignment?.date ||
        fallbackDayDate ||
        dateFromDateTime(assignment?.start);

      const shifts = Array.isArray(assignment?.shifts) ? assignment.shifts : [];

      shifts.forEach(shift => {
        rows.push(safeShift({
          dayDate: assignmentDayDate || dateFromDateTime(shift?.start),
          assignment,
          shift,
        }));
      });
    });
  });

  return rows;
}

function isRowInDateRange(row, startDate, endDateExclusive) {
  const rowDate = row.day_date || dateFromDateTime(row.shift_start) || dateFromDateTime(row.assignment_start);
  if (!rowDate) return false;
  return rowDate >= startDate && rowDate < endDateExclusive;
}

function durationHoursFromTimes(start, end) {
  if (!start || !end) return 0;
  const a = new Date(String(start).replace(" ", "T"));
  const b = new Date(String(end).replace(" ", "T"));
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  const hours = (b.getTime() - a.getTime()) / 36e5;
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) return 0;
  return Math.round(hours * 100) / 100;
}

function hoursForShift(row) {
  // Prefer the live Vector start/end duration. This protects projections from
  // stale length fields after assignment-time cleanup in Vector.
  return Number(
    durationHoursFromTimes(row?.shift_start, row?.shift_end) ||
    row?.shift_length ||
    row?.shift_real_length ||
    0
  );
}

export async function getScheduleRows(startDate, endDateExclusive) {
  // Query the exact requested local-midnight window, then filter by the normalized day_date.
  // CrewSense docs require start/end datetimes and schedule shifts live under days[].assignments[].shifts.
  const schedule = await vectorRequest("/v1/schedule", {
    query: { start: `${startDate} 00:00:00`, end: `${endDateExclusive} 00:00:00` },
  });
  const rows = flattenSchedule(schedule);
  return rows.filter(r => isRowInDateRange(r, startDate, endDateExclusive));
}

function shiftMatchesUser(shift, user) {
  if (!shift || !user) return false;

  if (shift.user_id != null && user.user_id != null && Number(shift.user_id) === Number(user.user_id)) {
    return true;
  }

  // Extra fallback for cases where Vector schedule rows return a different id field but the same human name.
  // This is only used after an exact email user match, so it is not opening public posting to random typed names.
  const scheduleName = normalizeNameKey(shift.user_name);
  const vectorName = normalizeNameKey(user.full_name || `${user.first_name || ""} ${user.last_name || ""}`);
  if (scheduleName && vectorName && scheduleName === vectorName) {
    return true;
  }

  return false;
}

export function findUserShifts(rows, user) {
  return rows.filter(shift => shiftMatchesUser(shift, user));
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
  const shifts = findUserShifts(rows, userResult.user);

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
    [`${prefix}_vector_shift_length`]: hoursForShift(shift) || shift?.shift_length || shift?.shift_real_length || null,
    [`${prefix}_vector_work_type_name`]: shift?.work_type_name ?? null,
    [`${prefix}_vector_group_labels`]: shift?.group_labels ?? [],
  };
}


export async function getVectorWeekHoursForPerson({ email, name, shiftDate, publicStrictEmail = true }) {
  requiredDate(shiftDate, "shiftDate");

  const userResult = await findVectorUser({ email, name, publicStrictEmail });
  if (!userResult.ok) {
    return {
      ok: false,
      allowed: false,
      blockReason: userResult.blockReason,
      message: "Vector could not confidently match this person.",
      emailMatchesFound: userResult.emailMatchesFound,
      nameMatchesFound: userResult.nameMatchesFound,
    };
  }

  const weekStart = weekStartMonday(shiftDate);
  const weekEnd = addDays(weekStart, 7);
  const weekRows = await getScheduleRows(weekStart, weekEnd);
  const weekShifts = findUserShifts(weekRows, userResult.user);

  const vectorWeekHours = weekShifts.reduce(
    (sum, shift) => sum + hoursForShift(shift),
    0
  );

  return {
    ok: true,
    vectorUser: userResult.user,
    matchMethod: userResult.matchMethod,
    matchConfidence: userResult.matchConfidence,
    week: {
      weekStart,
      weekEndExclusive: weekEnd,
      vectorWeekHours,
      shifts: weekShifts,
    },
  };
}

export async function checkApplicationEligibility({ email, name, shiftDate, postedShiftLength, publicStrictEmail = true, swapApplication = null }) {
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
  const sameDayShifts = findUserShifts(sameDayRows, userResult.user);
  const isRequestedSwapPartner = swapApplication?.isRequestedSwapPartner === true;
  const allowSameDayConflictForSwap = swapApplication?.allowSameDayConflict === true;

  if (sameDayShifts.length > 0 && !allowSameDayConflictForSwap) {
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

  // Requested swap partners are allowed to already be scheduled on the posted shift date
  // only when the listed swap is on that same date and for a different shift/bucket.
  // Same-bucket swaps are blocked in app/api/apply-shift/route.js before this helper is called.
  // This helper still returns the same-day shifts so LC Review can see what Vector found.

  // This is always the week of the posted shift date, not the current week and not the application date.
  const weekStart = weekStartMonday(shiftDate);
  const weekEnd = addDays(weekStart, 7);
  const weekRows = await getScheduleRows(weekStart, weekEnd);
  const weekShifts = findUserShifts(weekRows, userResult.user);

  const vectorWeekHours = weekShifts.reduce(
    (sum, shift) => sum + hoursForShift(shift),
    0
  );

  // Normal pickup adds the posted shift length.
  // Swap-partner approval should represent replacing the swap partner's offered shift
  // with the posted shift, so subtract the offered shift length when known.
  const swapReplacementShiftLength = isRequestedSwapPartner
    ? Number(swapApplication?.swapPartnerShiftLength || 0)
    : 0;
  const projectedAfterApproval = Math.max(0, vectorWeekHours - swapReplacementShiftLength) + shiftLength;
  const wouldBeOT = projectedAfterApproval > 40;

  return {
    ok: true,
    allowed: true,
    decision: "allow",
    blockReason: null,
    message: allowSameDayConflictForSwap && sameDayShifts.length > 0
      ? "Vector shows this requested swap partner is already scheduled on this date, but this is allowed because the swap is for a different shift."
      : wouldBeOT
        ? "Applicant is not scheduled on this date, but projected Vector hours exceed 40."
        : "Vector confirms this applicant is not scheduled on this date.",
    vectorUser: userResult.user,
    matchMethod: userResult.matchMethod,
    matchConfidence: userResult.matchConfidence,
    sameDay: { alreadyScheduled: sameDayShifts.length > 0, shifts: sameDayShifts, ignoredForSwap: allowSameDayConflictForSwap && sameDayShifts.length > 0 },
    week: {
      weekStart,
      weekEndExclusive: weekEnd,
      vectorWeekHours,
      postedShiftLength: shiftLength,
      swapReplacementShiftLength,
      projectedAfterApproval,
      wouldBeOT,
      shifts: weekShifts,
    },
  };
}
