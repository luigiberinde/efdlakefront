import { NextResponse } from "next/server";
import { requireLC } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase-server";
import { checkApplicationEligibility, normalizeEmail } from "@/lib/vector-core";

function shiftLengthFor(shift) {
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

function buildSwapApplicationContext(shift, applicantEmail) {
  const requestedSwapPartner = isRequestedSwapPartner(shift, applicantEmail);
  if (!requestedSwapPartner) return null;

  const postedShiftBucket = { date: shift.date, type: shift.type, time: shift.time };
  const swapPartnerBucket = { date: shift.swap_partner_date, type: shift.swap_partner_type, time: shift.swap_partner_time };

  return {
    isRequestedSwapPartner: true,
    allowSameDayConflict:
      String(shift.swap_partner_date || "") === String(shift.date || "") &&
      !sameShiftBucket(postedShiftBucket, swapPartnerBucket),
    postedShiftDate: shift.date,
    postedShiftType: shift.type,
    postedShiftTime: shift.time,
    postedVectorShiftId: shift.poster_vector_shift_id,
    swapPartnerDate: shift.swap_partner_date,
    swapPartnerType: shift.swap_partner_type,
    swapPartnerTime: shift.swap_partner_time,
    swapPartnerVectorShiftId: shift.swap_partner_vector_shift_id,
    swapPartnerShiftLength: Number(shift.swap_partner_vector_shift_length || 0),
  };
}

export async function POST(req) {
  const authErr = await requireLC();
  if (authErr) return NextResponse.json(authErr, { status: authErr.status || 401 });

  try {
    const { shiftId, appId } = await req.json();

    if (!shiftId || !appId) {
      return NextResponse.json({ success: false, error: "Missing shiftId or appId." }, { status: 400 });
    }

    const sb = getServiceClient();

    const { data: shift, error: shiftErr } = await sb
      .from("shifts")
      .select("*")
      .eq("id", shiftId)
      .single();

    if (shiftErr || !shift) {
      return NextResponse.json({ success: false, error: "Shift not found." }, { status: 404 });
    }

    const { data: app, error: appErr } = await sb
      .from("applications")
      .select("*")
      .eq("id", appId)
      .eq("shift_id", shiftId)
      .single();

    if (appErr || !app) {
      return NextResponse.json({ success: false, error: "Application not found." }, { status: 404 });
    }

    const shiftLength = shiftLengthFor(shift);
    if (!shiftLength || shiftLength <= 0) {
      return NextResponse.json({
        success: false,
        error: "This shift is missing a Vector/LC shift length, so current projected hours cannot be calculated.",
      }, { status: 400 });
    }

    const swapApplication = buildSwapApplicationContext(shift, app.applicant_email);

    const eligibility = await checkApplicationEligibility({
      email: app.applicant_email,
      name: app.applicant_name,
      shiftDate: shift.date,
      postedShiftLength: shiftLength,
      publicStrictEmail: true,
      swapApplication,
    });

    return NextResponse.json({
      success: true,
      checkedAt: new Date().toISOString(),
      shiftId,
      appId,
      shiftLength,
      applicationTime: {
        vectorWeekHours: app.applicant_vector_week_hours,
        projectedAfterApproval: app.applicant_vector_projected_hours ?? app.hours_after_shift,
        wouldBeOT: Boolean(app.applicant_vector_would_be_ot),
        checkedAt: app.applicant_vector_checked_at,
      },
      current: eligibility.week ? {
        vectorWeekHours: eligibility.week.vectorWeekHours,
        postedShiftLength: eligibility.week.postedShiftLength,
        swapReplacementShiftLength: eligibility.week.swapReplacementShiftLength,
        projectedAfterApproval: eligibility.week.projectedAfterApproval,
        wouldBeOT: eligibility.week.wouldBeOT,
        weekStart: eligibility.week.weekStart,
        weekEndExclusive: eligibility.week.weekEndExclusive,
      } : null,
      eligibility,
      warnings: [
        ...(eligibility.week?.wouldBeOT ? ["Projected current Vector hours exceed 40."] : []),
        ...(eligibility.sameDay?.ignoredForSwap ? ["Same-day conflict ignored because this is the requested swap partner applying for a different shift."] : []),
      ],
    });
  } catch (err) {
    console.error("current application hours error", err);
    return NextResponse.json({
      success: false,
      error: err.message || "Could not check current Vector hours.",
    }, { status: 500 });
  }
}
