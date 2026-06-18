import { NextResponse } from "next/server";
import { requireLC } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase-server";
import { addDays, findUserShifts, findVectorUser, getScheduleRows, getVectorWeekHoursForPerson, normalizeEmail } from "@/lib/vector-core";

function clean(v) { return String(v || "").trim(); }
function minutesFromTime(v) {
  if (!v) return null;
  const [h, m] = String(v).slice(0, 5).split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}
function timeFromVector(v) {
  if (!v) return "";
  const d = new Date(String(v).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return String(v).slice(11, 16) || String(v).slice(0, 5);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function durationHours(start, end) {
  const a = minutesFromTime(start);
  const b = minutesFromTime(end);
  if (a == null || b == null || b <= a) return 0;
  return Math.round(((b - a) / 60) * 100) / 100;
}
function shiftText(s) {
  return [s?.assignment_name, s?.work_type_name, ...(Array.isArray(s?.group_labels) ? s.group_labels : [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
function inferEarlyLate(s) {
  const t = shiftText(s);
  const hasEarly = /\bearly\b/.test(t);
  const hasLate = /\blate\b/.test(t);
  if (hasEarly && !hasLate) return "early";
  if (hasLate && !hasEarly) return "late";
  return null;
}
function primaryBucket(scheduledShifts) {
  return scheduledShifts.map(inferEarlyLate).filter(Boolean)[0] || null;
}
function labelShift(s) {
  if (!s) return "Unknown Vector shift";
  const bits = [];
  if (s.shift_start && s.shift_end) {
    const start = new Date(String(s.shift_start).replace(" ", "T"));
    const end = new Date(String(s.shift_end).replace(" ", "T"));
    const fmt = { hour: "numeric", minute: "2-digit" };
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      bits.push(`${start.toLocaleTimeString("en-US", fmt)}–${end.toLocaleTimeString("en-US", fmt)}`);
    }
  }
  if (s.assignment_name) bits.push(s.assignment_name);
  if (s.work_type_name) bits.push(s.work_type_name);
  return bits.join(" · ") || `Vector shift ${s.shift_id || s.id || ""}`;
}
function shiftLength(s) {
  const n = Number(s?.shift_length || s?.shift_real_length || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
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
function roundHours(n) {
  const x = Number(n || 0);
  return Math.round(x * 100) / 100;
}

export async function POST(req) {
  const authErr = await requireLC();
  if (authErr) return NextResponse.json(authErr, { status: authErr.status || 401 });

  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ success: false, error: "Missing On-Call ID." }, { status: 400 });

    const sb = getServiceClient();
    const { data: signup, error: signupErr } = await sb
      .from("on_call_signups")
      .select("*")
      .eq("id", id)
      .single();

    if (signupErr || !signup) {
      return NextResponse.json({ success: false, error: "On-Call signup not found." }, { status: 404 });
    }
    if (!["active", "used"].includes(signup.status)) {
      return NextResponse.json({ success: false, error: "Only active or used On-Call signups can be refreshed." }, { status: 400 });
    }

    const email = normalizeEmail(signup.normalized_email || signup.email);
    const name = clean(signup.vector_full_name || signup.name_entered);
    const date = String(signup.date || "").slice(0, 10);
    if (!email || !date) {
      return NextResponse.json({ success: false, error: "This On-Call signup is missing an email or date." }, { status: 400 });
    }

    const checkedAt = new Date().toISOString();
    const week = await getVectorWeekHoursForPerson({ email, name, shiftDate: date, publicStrictEmail: true });
    if (!week.ok) {
      await sb.from("on_call_signups").update({
        current_hours_check_status: "error",
        current_hours_check_error: week.message || "Could not calculate current Vector hours.",
        current_hours_checked_at: checkedAt,
        updated_at: checkedAt,
      }).eq("id", id);
      return NextResponse.json({ success: false, error: week.message || "Could not calculate current Vector hours.", vectorWeek: week }, { status: 400 });
    }

    const userResult = await findVectorUser({ email, name, publicStrictEmail: true });
    if (!userResult.ok) {
      await sb.from("on_call_signups").update({
        current_hours_check_status: "error",
        current_hours_check_error: userResult.message || "Vector could not confidently match that email.",
        current_hours_checked_at: checkedAt,
        updated_at: checkedAt,
      }).eq("id", id);
      return NextResponse.json({ success: false, error: userResult.message || "Vector could not confidently match that email.", vectorMatch: userResult }, { status: 400 });
    }

    const rows = await getScheduleRows(date, addDays(date, 1));
    const scheduledShifts = findUserShifts(rows, userResult.user);
    const alreadyScheduled = scheduledShifts.length > 0;
    const estimatedHours = estimateHours({
      availabilityType: signup.availability_type,
      customStart: signup.custom_start,
      customEnd: signup.custom_end,
      scheduledShifts,
      extraAvailabilityType: signup.extra_availability_type,
    });

    if (!estimatedHours || estimatedHours <= 0) {
      await sb.from("on_call_signups").update({
        current_hours_check_status: "error",
        current_hours_check_error: "Could not recalculate On-Call hours from the current signup details.",
        current_hours_checked_at: checkedAt,
        updated_at: checkedAt,
      }).eq("id", id);
      return NextResponse.json({ success: false, error: "Could not recalculate On-Call hours from the current signup details." }, { status: 400 });
    }

    const currentWeekHours = roundHours(week.week?.vectorWeekHours || 0);
    const projectedHours = roundHours(currentWeekHours + estimatedHours);
    const wouldBeOT = projectedHours > 40;
    const scheduledShiftLabel = scheduledShifts.map(labelShift).join("; ") || null;
    const scheduledShiftHours = scheduledShifts.reduce((sum, s) => sum + shiftLength(s), 0) || null;

    const patch = {
      current_week_hours_at_signup: currentWeekHours,
      projected_hours_if_used: projectedHours,
      would_be_ot: wouldBeOT,
      estimated_hours: estimatedHours,
      already_scheduled: alreadyScheduled,
      scheduled_shift_label: scheduledShiftLabel,
      scheduled_shift_start: scheduledShifts[0]?.shift_start || null,
      scheduled_shift_end: scheduledShifts[0]?.shift_end || null,
      scheduled_shift_hours: scheduledShiftHours,
      vector_user_id: userResult.user?.user_id ?? signup.vector_user_id ?? null,
      vector_employee_id: userResult.user?.employee_id ?? signup.vector_employee_id ?? null,
      vector_full_name: userResult.user?.full_name ?? signup.vector_full_name ?? null,
      vector_email: Array.isArray(userResult.user?.emails) ? userResult.user.emails[0] ?? signup.vector_email ?? null : signup.vector_email ?? null,
      current_week_hours_last_checked: currentWeekHours,
      projected_hours_if_used_last_checked: projectedHours,
      would_be_ot_last_checked: wouldBeOT,
      current_hours_checked_at: checkedAt,
      current_hours_check_status: "checked",
      current_hours_check_error: null,
      updated_at: checkedAt,
    };

    const { data: updated, error: updateErr } = await sb
      .from("on_call_signups")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();

    if (updateErr) throw updateErr;

    return NextResponse.json({
      success: true,
      signup: updated,
      checkedAt,
      currentWeekHours,
      estimatedHours,
      projectedHours,
      wouldBeOT,
      alreadyScheduled,
      scheduledShiftLabel,
    });
  } catch (err) {
    console.error("on-call refresh hours error", err);
    return NextResponse.json({ success: false, error: err.message || "Could not refresh On-Call hours." }, { status: 500 });
  }
}
