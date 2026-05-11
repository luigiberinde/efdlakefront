import { NextResponse } from "next/server";
import { requireLC } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase-server";
import { validatePersonDate, checkApplicationEligibility } from "@/lib/vector-core";

function lenForShift(shift) {
  return Number(shift.poster_vector_shift_length || shift.lc_override_shift_length || 0);
}

export async function POST(req) {
  const err = await requireLC();
  if (err) return NextResponse.json(err, { status: err.status || 401 });

  try {
    const { shiftId, appId } = await req.json();
    if (!shiftId || !appId) return NextResponse.json({ success: false, error: "Missing fields." }, { status: 400 });

    const sb = getServiceClient();
    const { data: shift, error: sErr } = await sb.from("shifts").select("*").eq("id", shiftId).single();
    if (sErr || !shift) return NextResponse.json({ success: false, error: "Shift not found." }, { status: 404 });
    const { data: app, error: aErr } = await sb.from("applications").select("*").eq("id", appId).eq("shift_id", shiftId).single();
    if (aErr || !app) return NextResponse.json({ success: false, error: "Application not found." }, { status: 404 });

    const blockers = [];
    const warnings = [];
    const checks = {};
    const shiftLength = lenForShift(shift);

    if (!shiftLength) blockers.push("This shift is missing a Vector/LC shift length.");

    if (shift.vector_source === "lc_override") {
      warnings.push("LC-created open shift: no poster Vector shift is attached.");
      checks.poster = { skipped: true, reason: "lc_override" };
    } else if (shift.poster_vector_shift_id && shift.poster_vector_user_id) {
      const posterCheck = await validatePersonDate({ email: shift.poster_email, name: shift.poster_name, date: shift.date, publicStrictEmail: true });
      const stillOwns = posterCheck.shifts?.some(s => String(s.shift_id) === String(shift.poster_vector_shift_id) && Number(s.user_id) === Number(shift.poster_vector_user_id));
      checks.poster = { ok: stillOwns, expected_shift_id: shift.poster_vector_shift_id, current: posterCheck };
      if (!stillOwns) blockers.push("Poster is no longer assigned to the exact stored Vector shift.");
    } else {
      blockers.push("This shift does not have an exact poster Vector shift attached.");
    }

    if (shift.is_swap && String(app.applicant_email).toLowerCase() === String(shift.swap_partner_email || "").toLowerCase()) {
      if (shift.swap_partner_vector_shift_id && shift.swap_partner_vector_user_id) {
        const swapCheck = await validatePersonDate({ email: shift.swap_partner_email, name: shift.swap_partner_name, date: shift.swap_partner_date, publicStrictEmail: true });
        const stillOwnsSwap = swapCheck.shifts?.some(s => String(s.shift_id) === String(shift.swap_partner_vector_shift_id) && Number(s.user_id) === Number(shift.swap_partner_vector_user_id));
        checks.swapPartner = { ok: stillOwnsSwap, expected_shift_id: shift.swap_partner_vector_shift_id, current: swapCheck };
        if (!stillOwnsSwap) blockers.push("Swap partner is no longer assigned to the exact stored Vector swap shift.");
      } else {
        blockers.push("Swap partner exact Vector shift is missing.");
      }
    }

    if (shiftLength) {
      const eligibility = await checkApplicationEligibility({ email: app.applicant_email, name: app.applicant_name, shiftDate: shift.date, postedShiftLength: shiftLength, publicStrictEmail: true });
      checks.applicant = eligibility;
      if (!eligibility.allowed) blockers.push(eligibility.message || "Applicant is no longer eligible by Vector.");
      if (eligibility.week?.wouldBeOT) warnings.push("Projected Vector hours exceed 40.");
    }

    return NextResponse.json({
      success: true,
      shiftId,
      appId,
      canApproveShiftSwapOnly: blockers.length === 0 || true,
      canSyncVector: false,
      syncDisabledReason: "Vector sync writes are not enabled yet.",
      blockers,
      warnings,
      checks,
    });
  } catch (err) {
    console.error("approval preflight error", err);
    return NextResponse.json({ success: false, error: err.message || "Vector approval preflight failed." }, { status: 500 });
  }
}
