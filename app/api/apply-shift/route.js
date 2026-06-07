import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { checkApplicationEligibility, normalizeEmail } from "@/lib/vector-core";

function cleanText(v) { return String(v || "").trim(); }
function shiftLengthFor(shift) {
  return Number(shift.poster_vector_shift_length || shift.lc_override_shift_length || 0);
}

function sameShiftBucket(a, b) {
  return (
    String(a?.date || "") === String(b?.date || "") &&
    String(a?.type || "") === String(b?.type || "") &&
    String(a?.time || "") === String(b?.time || "")
  );
}

function isRequestedSwapPartner(shift, applicantEmail) {
  return Boolean(shift?.is_swap) && normalizeEmail(shift?.swap_partner_email) === applicantEmail;
}

export async function POST(req) {
  try {
    const body = await req.json();
    const dryRun = body.dryRun === true;
    const shiftIds = Array.isArray(body.shiftIds) ? body.shiftIds : [];
    const applicantName = cleanText(body.name);
    const applicantEmail = normalizeEmail(body.email);
    const note = cleanText(body.note);

    if (!shiftIds.length || !applicantName || !applicantEmail) {
      return NextResponse.json({ success: false, error: "Missing application fields." }, { status: 400 });
    }

    const sb = getServiceClient();
    const { data: shifts, error: shiftErr } = await sb.from("shifts").select("*").in("id", shiftIds).eq("status", "open");
    if (shiftErr) return NextResponse.json({ success: false, error: "Could not load shifts." }, { status: 500 });
    if (!shifts || shifts.length !== shiftIds.length) return NextResponse.json({ success: false, error: "One or more shifts are no longer open." }, { status: 400 });

    const reviews = [];
    const rows = [];

    for (const shift of shifts) {
      if (normalizeEmail(shift.poster_email) === applicantEmail) {
        return NextResponse.json({
          success: false,
          code: "SELF_APPLICATION",
          error: "This is your own shift. You cannot apply to it, but you can delete the posting instead.",
          canDeleteShift: true,
          shiftId: shift.id,
          shift: {
            id: shift.id,
            poster_name: shift.poster_name,
            poster_email: shift.poster_email,
            date: shift.date,
            type: shift.type,
            time: shift.time,
          },
        }, { status: 409 });
      }

      const { data: existingApp, error: existingErr } = await sb
        .from("applications")
        .select("id, shift_id, applicant_email, applicant_name, status, applied_at")
        .eq("shift_id", shift.id)
        .eq("status", "pending")
        .ilike("applicant_email", applicantEmail)
        .maybeSingle();

      if (existingErr) {
        console.error("duplicate application lookup error", existingErr);
        return NextResponse.json({ success: false, error: "Could not check existing applications." }, { status: 500 });
      }

      if (existingApp) {
        return NextResponse.json({
          success: false,
          code: "DUPLICATE_APPLICATION",
          error: "You already applied for this shift. You can delete your existing application instead.",
          canDeleteApplication: true,
          applicationId: existingApp.id,
          shiftId: shift.id,
          application: existingApp,
          shift: {
            id: shift.id,
            poster_name: shift.poster_name,
            poster_email: shift.poster_email,
            date: shift.date,
            type: shift.type,
            time: shift.time,
          },
        }, { status: 409 });
      }

      const len = shiftLengthFor(shift);
      if (!len || len <= 0) {
        return NextResponse.json({ success: false, error: "This shift is missing a Vector/LC shift length. Contact an LC." }, { status: 400 });
      }

      const requestedSwapPartner = isRequestedSwapPartner(shift, applicantEmail);
      const postedShiftBucket = { date: shift.date, type: shift.type, time: shift.time };
      const swapPartnerBucket = { date: shift.swap_partner_date, type: shift.swap_partner_type, time: shift.swap_partner_time };

      if (requestedSwapPartner && sameShiftBucket(postedShiftBucket, swapPartnerBucket)) {
        return NextResponse.json({
          success: false,
          code: "INVALID_SAME_SHIFT_SWAP",
          error: "This swap is for the same shift date/type/time. Same-day swaps must be for different shifts, like Early for Late.",
          blockedShiftId: shift.id,
        }, { status: 400 });
      }

      const allowSameDayConflictForSwap =
        requestedSwapPartner &&
        String(shift.swap_partner_date || "") === String(shift.date || "") &&
        !sameShiftBucket(postedShiftBucket, swapPartnerBucket);

      const eligibility = await checkApplicationEligibility({
        email: applicantEmail,
        name: applicantName,
        shiftDate: shift.date,
        postedShiftLength: len,
        publicStrictEmail: true,
        swapApplication: requestedSwapPartner ? {
          isRequestedSwapPartner: true,
          allowSameDayConflict: allowSameDayConflictForSwap,
          postedShiftDate: shift.date,
          postedShiftType: shift.type,
          postedShiftTime: shift.time,
          postedVectorShiftId: shift.poster_vector_shift_id,
          swapPartnerDate: shift.swap_partner_date,
          swapPartnerType: shift.swap_partner_type,
          swapPartnerTime: shift.swap_partner_time,
          swapPartnerVectorShiftId: shift.swap_partner_vector_shift_id,
          swapPartnerShiftLength: Number(shift.swap_partner_vector_shift_length || 0),
        } : null,
      });
      reviews.push({ shift_id: shift.id, shift, eligibility, requestedSwapPartner });
      if (!eligibility.allowed) {
        return NextResponse.json({ success: false, error: eligibility.message || "Vector blocked this application.", blockedShiftId: shift.id, eligibility, reviews }, { status: 400 });
      }

      rows.push({
        shift_id: shift.id,
        applicant_name: applicantName,
        applicant_email: applicantEmail,
        hours_after_shift: eligibility.week?.projectedAfterApproval ?? 0,
        applicant_note: note,
        applicant_vector_user_id: eligibility.vectorUser?.user_id ?? null,
        applicant_vector_employee_id: eligibility.vectorUser?.employee_id ?? null,
        applicant_vector_full_name: eligibility.vectorUser?.full_name ?? null,
        applicant_vector_email: Array.isArray(eligibility.vectorUser?.emails) ? eligibility.vectorUser.emails[0] ?? null : null,
        applicant_vector_week_hours: eligibility.week?.vectorWeekHours ?? null,
        applicant_vector_projected_hours: eligibility.week?.projectedAfterApproval ?? null,
        applicant_vector_would_be_ot: eligibility.week?.wouldBeOT ?? false,
        applicant_vector_same_day_conflict: Boolean(eligibility.sameDay?.alreadyScheduled && !eligibility.sameDay?.ignoredForSwap),
        applicant_vector_check_status: eligibility.sameDay?.ignoredForSwap ? "swap_same_day_allowed" : "clear",
        applicant_vector_checked_at: new Date().toISOString(),
        applicant_vector_warnings: [
          ...(eligibility.week?.wouldBeOT ? ["Projected Vector hours exceed 40."] : []),
          ...(eligibility.sameDay?.ignoredForSwap ? ["Requested swap partner is already scheduled that date, but this is allowed because the swap is for a different shift."] : []),
        ],
      });
    }

    if (dryRun) return NextResponse.json({ success: true, dryRun: true, reviews, rowsPreview: rows });

    const { error } = await sb.from("applications").insert(rows);
    if (error) {
      console.error("apply-shift insert error", error);
      if (error.message?.includes("idx_unique_pending_app")) {
        return NextResponse.json({
          success: false,
          code: "DUPLICATE_APPLICATION",
          error: "You already applied for this shift. Refresh the page if you want to delete your application.",
          canDeleteApplication: true,
        }, { status: 409 });
      }
      return NextResponse.json({ success: false, error: error.message || "Error submitting application." }, { status: 500 });
    }

    return NextResponse.json({ success: true, reviews });
  } catch (err) {
    console.error("apply-shift route error", err);
    return NextResponse.json({ success: false, error: err.message || "Error submitting application." }, { status: 500 });
  }
}
