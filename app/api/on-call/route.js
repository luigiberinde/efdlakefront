import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { addDays, findUserShifts, findVectorUser, getScheduleRows, getVectorWeekHoursForPerson, normalizeEmail, requiredDate } from "@/lib/vector-core";

function clean(v) { return String(v || "").trim(); }
function normPhone(v) { return String(v || "").replace(/[^0-9+]/g, "").slice(0, 24); }
function minutesFromTime(v) {
  if (!v) return null;
  const [h, m] = String(v).slice(0,5).split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}
function timeFromVector(v) {
  if (!v) return "";
  const d = new Date(String(v).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return String(v).slice(11,16) || String(v).slice(0,5);
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}
function durationHours(start, end) {
  const a = minutesFromTime(start);
  const b = minutesFromTime(end);
  if (a == null || b == null || b <= a) return 0;
  return Math.round(((b - a) / 60) * 100) / 100;
}
function chicagoTodayStr() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = type => parts.find(p => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function shiftText(s) {
  return [s?.assignment_name, s?.work_type_name, ...(Array.isArray(s?.group_labels) ? s.group_labels : [])].filter(Boolean).join(" ").toLowerCase();
}
function inferEarlyLate(s) {
  const t = shiftText(s);
  const hasEarly = /\bearly\b/.test(t);
  const hasLate = /\blate\b/.test(t);
  if (hasEarly && !hasLate) return "early";
  if (hasLate && !hasEarly) return "late";
  return null;
}
function labelShift(s) {
  if (!s) return "Unknown Vector shift";
  const bits = [];
  if (s.shift_start && s.shift_end) bits.push(`${new Date(String(s.shift_start).replace(" ", "T")).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}–${new Date(String(s.shift_end).replace(" ", "T")).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`);
  if (s.assignment_name) bits.push(s.assignment_name);
  if (s.work_type_name) bits.push(s.work_type_name);
  return bits.join(" · ") || `Vector shift ${s.shift_id || ""}`;
}
function primaryBucket(scheduledShifts) {
  return scheduledShifts.map(inferEarlyLate).filter(Boolean)[0] || null;
}
function estimateHours({ availabilityType, customStart, customEnd, scheduledShifts, extraAvailabilityType }) {
  if (availabilityType === "early") return 6;
  if (availabilityType === "late") return 6.5;
  if (availabilityType === "both") return 12.5;
  if (availabilityType === "custom") return durationHours(customStart, customEnd);
  if (availabilityType === "extra_availability") {
    const scheduled = scheduledShifts[0] || null;
    const scheduledStart = timeFromVector(scheduled?.shift_start);
    const scheduledEnd = timeFromVector(scheduled?.shift_end);
    if (extraAvailabilityType === "come_in_earlier") return durationHours(customStart, scheduledStart);
    if (extraAvailabilityType === "stay_after_early") return durationHours(scheduledEnd, customEnd || customStart);
    if (extraAvailabilityType === "custom") return durationHours(customStart, customEnd);
    if (extraAvailabilityType === "all_day_if_approved") {
      const bucket = primaryBucket(scheduledShifts);
      if (bucket === "early") return 6.5;
      if (bucket === "late") return 6;
      return 12.5;
    }
  }
  return 0;
}
function validateExtraAvailability({ extraAvailabilityType, customStart, customEnd, scheduledShifts }) {
  const bucket = primaryBucket(scheduledShifts);
  if (extraAvailabilityType === "come_in_earlier" && bucket !== "late") {
    return "Vector must show you working a Late shift that day to offer to come in earlier. Choose All-Day/custom or contact an LC.";
  }
  if (extraAvailabilityType === "stay_after_early" && bucket !== "early") {
    return "Vector must show you working an Early shift that day to offer to stay later. Choose All-Day/custom or contact an LC.";
  }
  if (extraAvailabilityType === "come_in_earlier") {
    if (!customStart) return "Enter what time you can come in before your Late shift.";
    const scheduledStart = timeFromVector(scheduledShifts[0]?.shift_start);
    if (!durationHours(customStart, scheduledStart)) return "Your come-in time must be before your scheduled Late shift starts.";
  }
  if (extraAvailabilityType === "stay_after_early") {
    if (!(customEnd || customStart)) return "Enter what time you can stay until after your Early shift.";
    const scheduledEnd = timeFromVector(scheduledShifts[0]?.shift_end);
    if (!durationHours(scheduledEnd, customEnd || customStart)) return "Your stay-later time must be after your scheduled Early shift ends.";
  }
  if (extraAvailabilityType === "custom" && (!customStart || !customEnd)) return "Enter the exact custom start and end time.";
  return null;
}
function needsCustomWindow(availabilityType, extraAvailabilityType) {
  return availabilityType === "custom" || (availabilityType === "extra_availability" && ["custom"].includes(extraAvailabilityType));
}

export async function POST(req) {
  try {
    const body = await req.json();
    const dryRun = body.dryRun === true;
    const name = clean(body.name);
    const email = normalizeEmail(body.email);
    const phone = normPhone(body.phone);
    const date = requiredDate(body.date, "date");
    const rolePreference = ["guard", "manager", "either"].includes(body.rolePreference) ? body.rolePreference : "guard";
    const availabilityType = ["early", "late", "both", "custom", "extra_availability"].includes(body.availabilityType) ? body.availabilityType : "early";
    const extraAvailabilityType = ["stay_after_early", "come_in_earlier", "all_day_if_approved", "custom"].includes(body.extraAvailabilityType) ? body.extraAvailabilityType : null;
    const customStart = clean(body.customStart);
    const customEnd = clean(body.customEnd);
    const note = clean(body.note);

    if (!name || !email || !phone) return NextResponse.json({ success: false, error: "Enter your name, email, and phone number." }, { status: 400 });
    if (date < chicagoTodayStr()) return NextResponse.json({ success: false, error: "You cannot sign up for On-Call on a past date." }, { status: 400 });

    const sb = getServiceClient();
    const { data: sameDayRows, error: sameDayErr } = await sb
      .from("on_call_signups")
      .select("id, status, availability_type, extra_availability_type, created_at, on_call_approved_at")
      .eq("normalized_email", email)
      .eq("date", date)
      .in("status", ["active", "used"])
      .limit(5);
    if (sameDayErr && !String(sameDayErr.message || "").includes("on_call_signups")) throw sameDayErr;
    const usedExisting = (sameDayRows || []).find(r => r.status === "used");
    const activeExisting = (sameDayRows || []).find(r => r.status === "active");
    if (usedExisting) {
      return NextResponse.json({
        success: false,
        code: "ON_CALL_ALREADY_APPROVED",
        error: "You already have an approved/used On-Call record for this date. Contact an LC instead of submitting another On-Call signup.",
        existing: usedExisting,
      }, { status: 409 });
    }
    if (activeExisting) {
      return NextResponse.json({
        success: false,
        code: "DUPLICATE_ON_CALL",
        error: "You already have an active On-Call signup for this date. Use My Activity to remove it first, or contact an LC if it already got approved/changed.",
        existing: activeExisting,
      }, { status: 409 });
    }

    const userResult = await findVectorUser({ email, name, publicStrictEmail: true });
    if (!userResult.ok) return NextResponse.json({ success: false, error: "Vector could not confidently match that email. Double-check your email or contact an LC.", vectorMatch: userResult }, { status: 400 });

    const rows = await getScheduleRows(date, addDays(date, 1));
    const scheduledShifts = findUserShifts(rows, userResult.user);
    const alreadyScheduled = scheduledShifts.length > 0;

    if (alreadyScheduled && availabilityType !== "extra_availability") {
      return NextResponse.json({
        success: false,
        code: "ALREADY_SCHEDULED_ON_CALL",
        error: "Vector shows you are already scheduled on this date. You can still tell LCs you are available beyond your assigned shift, but you cannot list yourself as fully On-Call for that day.",
        alreadyScheduled,
        scheduledShifts,
      }, { status: 409 });
    }
    if (!alreadyScheduled && availabilityType === "extra_availability") {
      return NextResponse.json({ success: false, error: "Extra availability is only for people already working that day. Choose Early, Late, All-Day, or Custom instead." }, { status: 400 });
    }
    if (availabilityType === "extra_availability") {
      const extraErr = validateExtraAvailability({ extraAvailabilityType, customStart, customEnd, scheduledShifts });
      if (extraErr) return NextResponse.json({ success: false, error: extraErr, alreadyScheduled, scheduledShifts }, { status: 400 });
    }
    if (needsCustomWindow(availabilityType, extraAvailabilityType) && (!customStart || !customEnd)) {
      return NextResponse.json({ success: false, error: "Enter the exact time window you can work so LCs can see the real hours." }, { status: 400 });
    }

    const estimatedHours = estimateHours({ availabilityType, customStart, customEnd, scheduledShifts, extraAvailabilityType });
    if (!estimatedHours || estimatedHours <= 0) return NextResponse.json({ success: false, error: "Could not calculate On-Call hours. Check the option or time range." }, { status: 400 });

    const week = await getVectorWeekHoursForPerson({ email, name, shiftDate: date, publicStrictEmail: true });
    if (!week.ok) return NextResponse.json({ success: false, error: week.message || "Could not calculate Vector weekly hours." }, { status: 400 });
    const currentWeekHours = Number(week.week?.vectorWeekHours || 0);
    const projectedHours = Math.round((currentWeekHours + estimatedHours) * 100) / 100;
    const wouldBeOT = projectedHours > 40;

    const preview = {
      vectorUser: userResult.user,
      alreadyScheduled,
      scheduledShifts,
      scheduledShiftLabel: scheduledShifts.map(labelShift).join("; ") || null,
      currentWeekHours,
      estimatedHours,
      projectedHours,
      wouldBeOT,
      warning: wouldBeOT ? "This could put you over 40 hours. You can still sign up, but LCs must approve OT before using you." : null,
    };

    if (dryRun) return NextResponse.json({ success: true, dryRun: true, preview });

    const row = {
      name_entered: name,
      email,
      normalized_email: email,
      phone,
      date,
      role_preference: rolePreference,
      availability_type: availabilityType,
      custom_start: availabilityType === "custom" || (availabilityType === "extra_availability" && ["come_in_earlier", "custom"].includes(extraAvailabilityType)) ? customStart : null,
      custom_end: availabilityType === "custom" || (availabilityType === "extra_availability" && ["stay_after_early", "custom"].includes(extraAvailabilityType)) ? (customEnd || customStart || null) : null,
      estimated_hours: estimatedHours,
      already_scheduled: alreadyScheduled,
      scheduled_shift_label: preview.scheduledShiftLabel,
      scheduled_shift_start: scheduledShifts[0]?.shift_start || null,
      scheduled_shift_end: scheduledShifts[0]?.shift_end || null,
      scheduled_shift_hours: scheduledShifts.reduce((sum, s) => sum + Number(s.shift_length || s.shift_real_length || 0), 0) || null,
      extra_availability_type: availabilityType === "extra_availability" ? extraAvailabilityType : null,
      note,
      vector_user_id: userResult.user?.user_id ?? null,
      vector_employee_id: userResult.user?.employee_id ?? null,
      vector_full_name: userResult.user?.full_name ?? null,
      vector_email: Array.isArray(userResult.user?.emails) ? userResult.user.emails[0] ?? null : null,
      current_week_hours_at_signup: currentWeekHours,
      projected_hours_if_used: projectedHours,
      would_be_ot: wouldBeOT,
      status: "active",
      updated_at: new Date().toISOString(),
    };

    const { data: saved, error } = await sb.from("on_call_signups").insert(row).select("*").single();
    if (error) {
      if (String(error.message || "").includes("idx_unique_active_on_call_email_date")) {
        return NextResponse.json({ success: false, code: "DUPLICATE_ON_CALL", error: "You already have an active On-Call signup for this date. Use My Activity to remove it first." }, { status: 409 });
      }
      throw error;
    }

    return NextResponse.json({ success: true, signup: saved, preview, updatedExisting: false });
  } catch (err) {
    console.error("on-call route error", err);
    return NextResponse.json({ success: false, error: err.message || "Could not save On-Call signup." }, { status: 500 });
  }
}
