import { NextResponse } from "next/server";
import { requireLC } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase-server";

function chicagoTodayStr() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = type => parts.find(p => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function shiftLength(shift) {
  return Number(shift?.poster_vector_shift_length || shift?.lc_override_shift_length || 0);
}
function totalHoursForOnCallApplication(app) {
  const base = shiftLength(app?.shifts);
  const extra = Number(app?.on_call_estimated_hours || 0);
  if (app?.on_call_resolution_type === "all_day_if_approved") return 12.5;
  if (["come_in_earlier", "stay_after_early"].includes(app?.on_call_resolution_type)) return Math.round((base + extra) * 100) / 100;
  return extra || base || null;
}
function projectedHoursForOnCallApplication(app) {
  if (app?.on_call_projected_hours_if_used != null) return Number(app.on_call_projected_hours_if_used);
  const current = app?.applicant_vector_current_week_hours ?? app?.applicant_vector_week_hours;
  const total = totalHoursForOnCallApplication(app);
  if (current != null && total != null) return Math.round((Number(current) + Number(total)) * 100) / 100;
  return null;
}

export async function GET(req) {
  const authErr = await requireLC();
  if (authErr) return NextResponse.json(authErr, { status: authErr.status || 401 });
  try {
    const url = new URL(req.url);
    const date = url.searchParams.get("date");
    const todo = url.searchParams.get("todo");
    const today = chicagoTodayStr();
    const sb = getServiceClient();

    await sb.from("on_call_signups")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("status", "active")
      .lt("date", today);

    let q = sb.from("on_call_signups")
      .select("*")
      .order("date", { ascending: true })
      .order("status", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(500);
    if (todo === "pending" || todo === "done") {
      q = q.eq("status", "used").eq("todo_complete", todo === "done");
      if (date) q = q.eq("date", date);
    } else {
      q = q.in("status", ["active", "used"]);
      if (date) q = q.eq("date", date);
      else q = q.gte("date", today);
    }
    const { data, error } = await q;
    if (error) throw error;

    let signups = data || [];
    const ids = signups.map(s => s.id).filter(Boolean);
    if (ids.length > 0 && !(todo === "pending" || todo === "done")) {
      const { data: linkedApps, error: appErr } = await sb
        .from("applications")
        .select("id, status, on_call_signup_id, on_call_resolution_type, on_call_estimated_hours, on_call_projected_hours_if_used, on_call_would_be_ot, applicant_vector_week_hours, applicant_vector_current_week_hours, hours_after_shift, shifts(id, date, type, time, poster_vector_shift_length, lc_override_shift_length)")
        .in("on_call_signup_id", ids)
        .in("status", ["pending", "approved"])
        .order("applied_at", { ascending: false });
      if (appErr) throw appErr;
      const bySignup = new Map();
      for (const app of linkedApps || []) {
        const key = String(app.on_call_signup_id || "");
        if (!key || bySignup.has(key)) continue;
        const total = totalHoursForOnCallApplication(app);
        const projected = projectedHoursForOnCallApplication(app);
        bySignup.set(key, {
          id: app.id,
          status: app.status,
          shift_label: app.shifts ? `${app.shifts.time} ${app.shifts.type} on ${app.shifts.date}` : "Posted shift",
          base_shift_hours: shiftLength(app.shifts) || null,
          on_call_extra_hours: app.on_call_estimated_hours ?? null,
          total_hours_if_approved_with_on_call: total,
          projected_vector_hours_if_approved_with_on_call: projected,
          would_be_ot_if_approved_with_on_call: projected != null ? projected > 40 : !!app.on_call_would_be_ot,
          resolution_type: app.on_call_resolution_type,
        });
      }
      signups = signups.map(row => ({ ...row, pending_application: bySignup.get(String(row.id)) || null }));
    }

    return NextResponse.json({ success: true, signups, today });
  } catch (err) {
    console.error("on-call list error", err);
    return NextResponse.json({ success: false, error: err.message || "Could not load On-Call signups." }, { status: 500 });
  }
}
