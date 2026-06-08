import { getVectorWeekHoursForPerson, normalizeEmail, weekStartMonday, addDays } from "@/lib/vector-core";

export function shiftLengthForCurrentHours(shift) {
  return Number(shift?.poster_vector_shift_length || shift?.lc_override_shift_length || 0);
}

function sameShiftBucket(a, b) {
  return (
    String(a?.date || "") === String(b?.date || "") &&
    String(a?.type || "") === String(b?.type || "") &&
    String(a?.time || "") === String(b?.time || "")
  );
}

function isRequestedSwapPartner(shift, applicantEmail) {
  return Boolean(shift?.is_swap) && normalizeEmail(shift?.swap_partner_email) === normalizeEmail(applicantEmail);
}

function swapReplacementLengthFor(shift, applicantEmail) {
  const requestedSwapPartner = isRequestedSwapPartner(shift, applicantEmail);
  if (!requestedSwapPartner) return 0;

  const postedShiftBucket = { date: shift.date, type: shift.type, time: shift.time };
  const swapPartnerBucket = {
    date: shift.swap_partner_date,
    type: shift.swap_partner_type,
    time: shift.swap_partner_time,
  };

  const sameDayDifferentBucket =
    String(shift.swap_partner_date || "") === String(shift.date || "") &&
    !sameShiftBucket(postedShiftBucket, swapPartnerBucket);

  // For swap partners, approval replaces their listed offered shift when known.
  // We subtract the offered shift length whether the swap is same-day or different-day,
  // because this is a swap, not a normal pickup.
  return requestedSwapPartner || sameDayDifferentBucket
    ? Number(shift.swap_partner_vector_shift_length || 0)
    : 0;
}

function dateInRange(date, start, endExclusive) {
  const d = String(date || "");
  return d >= start && d < endExclusive;
}

function publicAppShape(app, shift, current, checkedAt) {
  const shiftLength = shiftLengthForCurrentHours(shift);
  const swapReplacementShiftLength = swapReplacementLengthFor(shift, app.applicant_email);
  const projectedAfterApproval = Math.max(0, Number(current.vectorWeekHours || 0) - swapReplacementShiftLength) + shiftLength;
  const wouldBeOT = projectedAfterApproval > 40;
  const warnings = [
    ...(wouldBeOT ? ["Current projected Vector hours exceed 40."] : []),
    ...(swapReplacementShiftLength ? [`Projected hours subtract the listed swap shift length (${swapReplacementShiftLength} hrs).`] : []),
  ];

  return {
    appId: app.id,
    shiftId: app.shift_id,
    status: app.status,
    applicantEmail: app.applicant_email,
    shiftDate: shift.date,
    shiftType: shift.type,
    shiftTime: shift.time,
    applicationTime: {
      vectorWeekHours: app.applicant_vector_week_hours,
      projectedAfterApproval: app.applicant_vector_projected_hours ?? app.hours_after_shift,
      wouldBeOT: Boolean(app.applicant_vector_would_be_ot),
      checkedAt: app.applicant_vector_checked_at,
    },
    current: {
      vectorWeekHours: current.vectorWeekHours,
      postedShiftLength: shiftLength,
      swapReplacementShiftLength,
      projectedAfterApproval,
      wouldBeOT,
      weekStart: current.weekStart,
      weekEndExclusive: current.weekEndExclusive,
      checkedAt,
      warnings,
    },
  };
}

export async function refreshCurrentHoursForApplicantWeek({
  sb,
  applicantEmail,
  applicantName,
  shiftDate,
  includeStatuses = ["pending"],
}) {
  const normalizedEmail = normalizeEmail(applicantEmail);
  if (!normalizedEmail) throw new Error("Applicant email is required.");
  if (!shiftDate) throw new Error("Shift date is required.");

  const checkedAt = new Date().toISOString();
  const weekStart = weekStartMonday(shiftDate);
  const weekEndExclusive = addDays(weekStart, 7);

  const vectorWeek = await getVectorWeekHoursForPerson({
    email: normalizedEmail,
    name: applicantName,
    shiftDate,
    publicStrictEmail: true,
  });

  if (!vectorWeek.ok) {
    return {
      success: false,
      checkedAt,
      error: vectorWeek.message || "Could not refresh current Vector hours.",
      vectorWeek,
      updatedApplications: [],
    };
  }

  const { data: candidateApps, error: appsError } = await sb
    .from("applications")
    .select("*")
    .ilike("applicant_email", normalizedEmail)
    .in("status", includeStatuses);

  if (appsError) throw appsError;

  const shiftIds = [...new Set((candidateApps || []).map((a) => a.shift_id).filter(Boolean))];

  if (!shiftIds.length) {
    return {
      success: true,
      checkedAt,
      vectorUser: vectorWeek.vectorUser,
      currentWeekHours: vectorWeek.week.vectorWeekHours,
      weekStart,
      weekEndExclusive,
      updatedApplications: [],
    };
  }

  const { data: shifts, error: shiftsError } = await sb
    .from("shifts")
    .select("*")
    .in("id", shiftIds);

  if (shiftsError) throw shiftsError;

  const shiftsById = new Map((shifts || []).map((s) => [String(s.id), s]));
  const relevantApps = (candidateApps || []).filter((app) => {
    const shift = shiftsById.get(String(app.shift_id));
    return shift && dateInRange(shift.date, weekStart, weekEndExclusive);
  });

  const currentBase = {
    vectorWeekHours: vectorWeek.week.vectorWeekHours,
    weekStart,
    weekEndExclusive,
  };

  const updatedApplications = [];
  for (const app of relevantApps) {
    const shift = shiftsById.get(String(app.shift_id));
    const shaped = publicAppShape(app, shift, currentBase, checkedAt);
    const warnings = shaped.current.warnings;

    const { error: updateError } = await sb
      .from("applications")
      .update({
        applicant_vector_current_week_hours: shaped.current.vectorWeekHours,
        applicant_vector_current_projected_hours: shaped.current.projectedAfterApproval,
        applicant_vector_current_would_be_ot: shaped.current.wouldBeOT,
        applicant_vector_current_checked_at: checkedAt,
        applicant_vector_current_check_status: "checked",
        applicant_vector_current_warnings: warnings,
      })
      .eq("id", app.id);

    if (updateError) throw updateError;
    updatedApplications.push(shaped);
  }

  return {
    success: true,
    checkedAt,
    vectorUser: vectorWeek.vectorUser,
    currentWeekHours: vectorWeek.week.vectorWeekHours,
    weekStart,
    weekEndExclusive,
    updatedApplications,
  };
}
