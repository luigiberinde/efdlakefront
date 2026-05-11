import { NextResponse } from "next/server";
import { requireLC } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase-server";
import { validatePersonDate, chooseVectorShift, vectorShiftColumns, normalizeEmail } from "@/lib/vector-core";

function cleanText(v) { return String(v || "").trim(); }
function cleanEmail(v) { return normalizeEmail(v); }
function numOrNull(v) { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }

export async function POST(req) {
  try {
    const body = await req.json();
    const dryRun = body.dryRun === true;
    const lcOverride = body.lcOverride === true;

    const posterName = cleanText(body.name);
    const posterEmail = cleanEmail(body.email);
    const type = body.type === "manager" ? "manager" : "guard";
    const time = body.time === "late" ? "late" : "early";
    const date = cleanText(body.date);
    const note = cleanText(body.note);
    const isSwap = body.isSwap === true;
    const hasPreferred = body.hasPreferred === true;

    if (!posterName || !posterEmail || !date) {
      return NextResponse.json({ success: false, error: "Fill in all required fields." }, { status: 400 });
    }
    if (isSwap && hasPreferred) {
      return NextResponse.json({ success: false, error: "Choose either a swap request or a preferred applicant, not both." }, { status: 400 });
    }

    const sb = getServiceClient();
    const { count } = await sb.from("shifts").select("id", { count: "exact", head: true })
      .eq("status", "open").eq("poster_email", posterEmail).eq("date", date).eq("type", type).eq("time", time);
    if ((count || 0) > 0) {
      return NextResponse.json({ success: false, error: "This shift was already posted under this email. Please contact an LC if you think this is an issue." }, { status: 400 });
    }

    let warnings = [];
    let insertVector = {};
    let posterVector = null;
    let selectedPosterShift = null;

    if (lcOverride) {
      const err = await requireLC();
      if (err) return NextResponse.json(err, { status: err.status || 401 });
      const overrideLength = numOrNull(body.lcShiftLength);
      if (!overrideLength) {
        return NextResponse.json({ success: false, error: "LC-created open shifts need a shift length so Vector hours can be calculated." }, { status: 400 });
      }
      insertVector = {
        vector_source: "lc_override",
        vector_check_status: "lc_override",
        vector_checked_at: new Date().toISOString(),
        lc_override_shift_length: overrideLength,
        lc_override_shift_start: cleanText(body.lcShiftStart) || null,
        lc_override_shift_end: cleanText(body.lcShiftEnd) || null,
        poster_vector_shift_length: overrideLength,
      };
      warnings.push("LC-created open shift: no poster Vector shift is attached.");
    } else {
      posterVector = await validatePersonDate({ email: posterEmail, name: posterName, date, publicStrictEmail: true });
      if (!posterVector.allowed) {
        return NextResponse.json({ success: false, error: posterVector.message, vector: posterVector }, { status: 400 });
      }
      if (posterVector.shifts.length > 1 && !body.selectedVectorShiftId) {
        return NextResponse.json({ success: false, needsShiftSelection: true, selectionFor: "poster", error: "Vector found multiple shifts for this date. Choose the exact shift you are posting.", shifts: posterVector.shifts, vector: posterVector }, { status: 409 });
      }
      selectedPosterShift = chooseVectorShift(posterVector.shifts, body.selectedVectorShiftId);
      if (!selectedPosterShift) {
        return NextResponse.json({ success: false, error: "Could not identify the exact Vector shift to post." }, { status: 400 });
      }
      insertVector = {
        vector_source: "vector_confirmed",
        vector_check_status: "confirmed",
        vector_checked_at: new Date().toISOString(),
        ...vectorShiftColumns("poster", posterVector.vectorUser, selectedPosterShift),
      };
    }

    let swapFields = {};
    let swapVector = null;
    let selectedSwapShift = null;
    if (isSwap) {
      const swapName = cleanText(body.swapName);
      const swapEmail = cleanEmail(body.swapEmail);
      const swapDate = cleanText(body.swapDate);
      if (!swapName || !swapEmail || !swapDate) {
        return NextResponse.json({ success: false, error: "Fill in all swap partner details." }, { status: 400 });
      }
      swapVector = await validatePersonDate({ email: swapEmail, name: swapName, date: swapDate, publicStrictEmail: true });
      if (!swapVector.allowed) {
        return NextResponse.json({ success: false, error: "Vector could not confirm the swap partner is scheduled on their listed swap date. Double-check the swap details or contact an LC.", vector: swapVector }, { status: 400 });
      }
      if (swapVector.shifts.length > 1 && !body.selectedSwapVectorShiftId) {
        return NextResponse.json({ success: false, needsShiftSelection: true, selectionFor: "swap", error: "Vector found multiple shifts for the swap partner on their listed date. Choose the exact shift they are offering.", shifts: swapVector.shifts, vector: swapVector }, { status: 409 });
      }
      selectedSwapShift = chooseVectorShift(swapVector.shifts, body.selectedSwapVectorShiftId);
      if (!selectedSwapShift) {
        return NextResponse.json({ success: false, error: "Could not identify the exact Vector shift for the swap partner." }, { status: 400 });
      }
      swapFields = vectorShiftColumns("swap_partner", swapVector.vectorUser, selectedSwapShift);
    }

    let preferredFields = {};
    if (hasPreferred) {
      const prefName = cleanText(body.prefName);
      const prefEmail = cleanEmail(body.prefEmail);
      const prefReason = cleanText(body.prefReason);
      if (!prefName || !prefEmail || !prefReason) {
        return NextResponse.json({ success: false, error: "Fill in the preferred applicant name, email, and reason." }, { status: 400 });
      }
      const prefVector = await validatePersonDate({ email: prefEmail, name: prefName, date, publicStrictEmail: true });
      preferredFields.preferred_vector_check_status = prefVector.allowed ? "already_scheduled" : prefVector.blockReason === "not_scheduled_on_date" ? "clear" : "not_found";
      preferredFields.preferred_vector_checked_at = new Date().toISOString();
      preferredFields.preferred_vector_warnings = [];
      if (prefVector.vectorUser) {
        preferredFields.preferred_vector_user_id = prefVector.vectorUser.user_id;
        preferredFields.preferred_vector_employee_id = prefVector.vectorUser.employee_id;
        preferredFields.preferred_vector_full_name = prefVector.vectorUser.full_name;
        preferredFields.preferred_vector_email = Array.isArray(prefVector.vectorUser.emails) ? prefVector.vectorUser.emails[0] ?? null : null;
      }
      if (prefVector.allowed) {
        const msg = "Preferred applicant appears already scheduled on this shift date.";
        preferredFields.preferred_vector_warnings.push(msg);
        warnings.push(msg);
      } else if (prefVector.blockReason && prefVector.blockReason !== "not_scheduled_on_date") {
        const msg = "Vector could not confirm the preferred applicant.";
        preferredFields.preferred_vector_warnings.push(msg);
        warnings.push(msg);
      }
    }

    const payload = {
      poster_name: posterName,
      poster_email: posterEmail,
      type,
      time,
      date,
      private_lc_note: note,
      is_swap: isSwap,
      swap_partner_name: isSwap ? cleanText(body.swapName) : null,
      swap_partner_email: isSwap ? cleanEmail(body.swapEmail) : null,
      swap_partner_type: isSwap ? (body.swapType === "manager" ? "manager" : "guard") : null,
      swap_partner_time: isSwap ? (body.swapTime === "late" ? "late" : "early") : null,
      swap_partner_date: isSwap ? cleanText(body.swapDate) : null,
      has_preferred: hasPreferred,
      preferred_name: hasPreferred ? cleanText(body.prefName) : null,
      preferred_email: hasPreferred ? cleanEmail(body.prefEmail) : null,
      preferred_reason: hasPreferred ? cleanText(body.prefReason) : null,
      vector_warnings: warnings,
      ...insertVector,
      ...swapFields,
      ...preferredFields,
    };

    if (dryRun) {
      return NextResponse.json({ success: true, dryRun: true, payloadPreview: payload, warnings, posterVector, selectedPosterShift, swapVector, selectedSwapShift });
    }

    const { error } = await sb.from("shifts").insert(payload);
    if (error) {
      console.error("post-shift insert error", error);
      return NextResponse.json({ success: false, error: error.message || "Error posting shift." }, { status: 500 });
    }
    return NextResponse.json({ success: true, warnings });
  } catch (err) {
    console.error("post-shift route error", err);
    return NextResponse.json({ success: false, error: err.message || "Error posting shift." }, { status: 500 });
  }
}
