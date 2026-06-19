import { NextResponse } from "next/server";
import { requireLC, currentPortalOrLakefront, normalizeShiftTypeForPortal } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase-server";
import { validatePersonDate, chooseVectorShift, vectorShiftColumns, normalizeEmail } from "@/lib/vector-core";
import { isEmailEnabled, sendNotificationEmail } from "@/lib/gmail";

function cleanText(v) { return String(v || "").trim(); }
function cleanEmail(v) { return normalizeEmail(v); }
function todayChicago() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function numOrNull(v) { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }

function fmtDay(d) {
  return new Date(String(d) + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}
function titleCase(value) {
  return String(value || "").trim().split(/\s+/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}
function shiftLabel(type, time) { return [titleCase(time), titleCase(type)].filter(Boolean).join(" "); }
function shiftText(s) {
  return [s?.assignment_name, s?.work_type_name, ...(Array.isArray(s?.group_labels) ? s.group_labels : [])].filter(Boolean).join(" ").toLowerCase();
}
function exactEarlyLate(s) {
  const txt = shiftText(s);
  const hasEarly = /\bearly\b/.test(txt);
  const hasLate = /\blate\b/.test(txt);
  if (hasEarly && !hasLate) return "early";
  if (hasLate && !hasEarly) return "late";
  return null;
}
function inferredEarlyLate(s, fallback) {
  return exactEarlyLate(s) || (fallback === "late" ? "late" : "early");
}
function vectorShiftLabelForWarning(s) {
  return [s?.assignment_name, s?.work_type_name, s?.shift_start && s?.shift_end ? `${s.shift_start}–${s.shift_end}` : null].filter(Boolean).join(" · ") || `Vector shift ${s?.shift_id || "unknown"}`;
}
function sameDate(a, b) { return String(a || "") === String(b || ""); }
function sameVectorShift(a, b) { return a?.shift_id && b?.shift_id && String(a.shift_id) === String(b.shift_id); }
async function notifyMatchingWatchers(sb, shift) {
  if (!isEmailEnabled() || !shift?.id || shift.status !== "open") return { sent: 0, skipped: true };
  const { data: watchers, error } = await sb.from("shift_watch_requests")
    .select("*")
    .eq("portal", shift.portal || "lakefront")
    .eq("status", "active")
    .lte("start_date", shift.date)
    .gte("end_date", shift.date);
  if (error) throw error;
  const matches = (watchers || []).filter(w =>
    (w.type === "any" || w.type === shift.type) &&
    (w.time === "any" || w.time === shift.time) &&
    normalizeEmail(w.email) !== normalizeEmail(shift.poster_email)
  );

  // Deduplicate by email so overlapping Notify Me alerts do not spam someone
  // with multiple emails for the exact same posted shift. Prefer the most
  // specific matching alert, then the newest one.
  const specificity = (w) => (w.type === "any" ? 0 : 1) + (w.time === "any" ? 0 : 1);
  const byEmail = new Map();
  for (const w of matches) {
    const emailKey = normalizeEmail(w.email);
    if (!emailKey) continue;
    const prior = byEmail.get(emailKey);
    if (!prior || specificity(w) > specificity(prior) || (specificity(w) === specificity(prior) && String(w.created_at || "") > String(prior.created_at || ""))) {
      byEmail.set(emailKey, w);
    }
  }

  const dedupedMatches = Array.from(byEmail.values()).slice(0, 50);
  let sent = 0;
  for (const w of dedupedMatches) {
    try {
      await sendNotificationEmail({
        recipient_email: w.email,
        recipient_name: w.name || "there",
        subject: `Shift posted: ${fmtDay(shift.date)}, ${shiftLabel(shift.type, shift.time)}`,
        body: `Hello ${w.name || "there"},\n\nA matching shift was just posted on the Lakefront Shift Swap board.\n\nShift: ${shiftLabel(shift.type, shift.time)}\nDate: ${fmtDay(shift.date)}\nPosted by: ${shift.poster_vector_full_name || shift.poster_name}\n\nThis email does not apply for you automatically. Open the Shift Swap board and apply if you want it.\n\nTo stop these alerts, open the Shift Swap board, click My Activity, enter this same email address, and unsubscribe from the Notify Me alert.\n\nBest,\nLCs`,
      });
      sent += 1;
    } catch (err) {
      console.error("watch notification send failed", err);
    }
  }
  return { sent };
}

export async function POST(req) {
  try {
    const body = await req.json();
    const dryRun = body.dryRun === true;
    const lcOverride = body.lcOverride === true;
    const portal = await currentPortalOrLakefront();

    const posterName = cleanText(body.name);
    const posterEmail = cleanEmail(body.email);
    const type = normalizeShiftTypeForPortal(body.type, portal);
    const time = body.time === "late" ? "late" : "early";
    const date = cleanText(body.date);
    const note = cleanText(body.note);
    const isSwap = body.isSwap === true;
    const hasPreferred = body.hasPreferred === true;

    if (!posterName || !posterEmail || !date) {
      return NextResponse.json({ success: false, error: "Fill in all required fields." }, { status: 400 });
    }
    if (date < todayChicago()) {
      return NextResponse.json({ success: false, error: "You cannot post a shift before today's date." }, { status: 400 });
    }
    if (isSwap && hasPreferred) {
      return NextResponse.json({ success: false, error: "Choose either a swap request or a preferred applicant, not both." }, { status: 400 });
    }

    const sb = getServiceClient();
    const { count } = await sb.from("shifts").select("id", { count: "exact", head: true })
      .eq("portal", portal).eq("status", "open").eq("poster_email", posterEmail).eq("date", date).eq("type", type).eq("time", time);
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
      if (swapDate < todayChicago()) {
        return NextResponse.json({ success: false, error: "The swap partner's shift date cannot be before today's date." }, { status: 400 });
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
      const listedSwapTime = body.swapTime === "late" ? "late" : "early";
      const exactSwapBucket = exactEarlyLate(selectedSwapShift);
      if (exactSwapBucket && exactSwapBucket !== listedSwapTime) {
        warnings.push(`Swap partner shift warning: Vector shows their exact shift looks like ${titleCase(exactSwapBucket)}, but it was marked as ${titleCase(listedSwapTime)}. Exact Vector shift: ${vectorShiftLabelForWarning(selectedSwapShift)}.`);
      }

      if (sameDate(date, swapDate)) {
        // Same-day swaps are the one intentional exception to the "don't pick up a shift on a date
        // you're already scheduled" rule. They are allowed only when the exact buckets differ.
        const posterBucket = inferredEarlyLate(selectedPosterShift, time);
        const swapBucket = inferredEarlyLate(selectedSwapShift, listedSwapTime);
        if (sameVectorShift(selectedPosterShift, selectedSwapShift) || (posterBucket && swapBucket && posterBucket === swapBucket)) {
          return NextResponse.json({ success: false, error: `Vector shows both people are working the same ${posterBucket || "shift"} bucket on this date. Same-day swaps must be different shifts, like Early ↔ Late.` }, { status: 400 });
        }
      } else {
        // For different-day swaps, each person must be free on the date they would pick up.
        // A gives up `date` and would pick up `swapDate`; B gives up `swapDate` and would pick up `date`.
        const posterOnSwapDate = await validatePersonDate({ email: posterEmail, name: posterName, date: swapDate, publicStrictEmail: true });
        if (posterOnSwapDate.allowed) {
          return NextResponse.json({
            success: false,
            error: `This swap cannot be posted because ${posterOnSwapDate.vectorUser?.full_name || posterName} is already scheduled in Vector on ${fmtDay(swapDate)}, which is the date they would be picking up from the swap partner.`,
            vector: posterOnSwapDate,
          }, { status: 400 });
        }
        const swapPartnerOnPosterDate = await validatePersonDate({ email: swapEmail, name: swapName, date, publicStrictEmail: true });
        if (swapPartnerOnPosterDate.allowed) {
          return NextResponse.json({
            success: false,
            error: `This swap cannot be posted because ${swapPartnerOnPosterDate.vectorUser?.full_name || swapName} is already scheduled in Vector on ${fmtDay(date)}, which is the date they would be picking up from the poster.`,
            vector: swapPartnerOnPosterDate,
          }, { status: 400 });
        }
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

      // Preferred applicant must be a real Vector person, but must NOT already be working on the posted shift date.
      // This keeps preferred-applicant posts advisory without letting people list someone who cannot actually pick up the shift.
      if (!prefVector.vectorUser || (prefVector.blockReason && prefVector.blockReason !== "not_scheduled_on_date")) {
        return NextResponse.json({ success: false, error: "Vector could not confirm the preferred applicant exists. Double-check their name/email or contact an LC.", vector: prefVector }, { status: 400 });
      }
      if (prefVector.allowed) {
        return NextResponse.json({ success: false, error: "The preferred applicant is already scheduled in Vector on this shift date, so they cannot be listed as preferred for this shift." , vector: prefVector }, { status: 400 });
      }

      preferredFields.preferred_vector_check_status = "clear";
      preferredFields.preferred_vector_checked_at = new Date().toISOString();
      preferredFields.preferred_vector_warnings = [];
      preferredFields.preferred_vector_user_id = prefVector.vectorUser.user_id;
      preferredFields.preferred_vector_employee_id = prefVector.vectorUser.employee_id;
      preferredFields.preferred_vector_full_name = prefVector.vectorUser.full_name;
      preferredFields.preferred_vector_email = Array.isArray(prefVector.vectorUser.emails) ? prefVector.vectorUser.emails[0] ?? null : null;
    }

    const payload = {
      portal,
      poster_name: posterName,
      poster_email: posterEmail,
      type,
      time,
      date,
      private_lc_note: note,
      is_swap: isSwap,
      swap_partner_name: isSwap ? cleanText(body.swapName) : null,
      swap_partner_email: isSwap ? cleanEmail(body.swapEmail) : null,
      swap_partner_type: isSwap ? normalizeShiftTypeForPortal(body.swapType, portal) : null,
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

    const { data: insertedShift, error } = await sb.from("shifts").insert(payload).select("*").single();
    if (error) {
      console.error("post-shift insert error", error);
      return NextResponse.json({ success: false, error: error.message || "Error posting shift." }, { status: 500 });
    }
    let watchNotifications = null;
    try {
      watchNotifications = await notifyMatchingWatchers(sb, insertedShift);
    } catch (notifyErr) {
      console.error("watch notification failure", notifyErr);
      watchNotifications = { sent: 0, error: notifyErr.message || "Notification send failed." };
    }
    return NextResponse.json({ success: true, warnings, shift: insertedShift, watchNotifications });
  } catch (err) {
    console.error("post-shift route error", err);
    return NextResponse.json({ success: false, error: err.message || "Error posting shift." }, { status: 500 });
  }
}
