import { NextResponse } from "next/server";
import { requireLC, getAuthStatus } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase-server";
import { buildApprovalNotifications } from "@/lib/notifications";
import { isEmailEnabled, sendNotificationEmail } from "@/lib/gmail";
import { refreshCurrentHoursForApplicantWeek } from "@/lib/current-hours-refresh";

async function insertNotificationRow(sb, row) {
  const { error } = await sb.from("notifications").insert(row);
  if (error) {
    console.error("notifications insert error", error);
    return { error };
  }
  return { error: null };
}
function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && String(value).trim() !== "") return value;
  }
  return null;
}
function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function shiftLengthFor(shift) {
  return numberOrNull(shift?.poster_vector_shift_length) ?? numberOrNull(shift?.lc_override_shift_length) ?? 0;
}
function onCallTotalHoursForApproval(extraType, baseShiftLength, onCallEstimatedHours) {
  const base = Number(baseShiftLength || 0);
  const extra = Number(onCallEstimatedHours || 0);
  if (extraType === "all_day_if_approved") return 12.5;
  if (["come_in_earlier", "stay_after_early"].includes(extraType)) return Math.round((base + extra) * 100) / 100;
  return extra || null;
}

export async function POST(req) {
  const err = await requireLC();
  if (err) return NextResponse.json(err, { status: err.status });

  const { portal } = await getAuthStatus();
  const { shiftId, appId, onCallApproval } = await req.json();
  const safeOnCallApproval = onCallApproval && typeof onCallApproval === "object" ? onCallApproval : null;
  const onCallApprovalMode = ["normal", "use_on_call", "lc_custom"].includes(safeOnCallApproval?.mode) ? safeOnCallApproval.mode : "normal";
  const onCallCustomStart = String(safeOnCallApproval?.customStart || "").trim();
  const onCallCustomEnd = String(safeOnCallApproval?.customEnd || "").trim();
  const onCallCustomInstructions = String(safeOnCallApproval?.instructions || "").trim();

  if (!shiftId || !appId) {
    return NextResponse.json(
      { success: false, error: "Missing fields" },
      { status: 400 }
    );
  }

  const sb = getServiceClient();

  const { data, error } = await sb.rpc("approve_application", {
    p_shift_id: shiftId,
    p_app_id: appId,
    p_portal: portal || "lakefront",
  });

  if (error) {
    console.error("approve_application RPC error", error);
    return NextResponse.json(
      { success: false, error: "Database error" },
      { status: 500 }
    );
  }

  if (!data?.success) {
    return NextResponse.json(data, { status: 400 });
  }

  // Fetch current shift context after approval.
  const { data: shiftContext, error: shiftContextError } = await sb
    .from("shifts")
    .select(`
      id,
      vector_source,
      poster_name,
      poster_email,
      poster_vector_full_name,
      type,
      time,
      date,
      poster_vector_shift_length,
      lc_override_shift_length,
      is_swap,
      swap_partner_name,
      swap_partner_email,
      swap_partner_type,
      swap_partner_time,
      swap_partner_date,
      swap_partner_vector_full_name
    `)
    .eq("id", shiftId)
    .eq("portal", portal || "lakefront")
    .single();

  if (shiftContextError) {
    console.error("approval shift context error", shiftContextError);
  }

  // Fetch application context after approval, especially Vector-matched applicant name.
  const { data: applicationContext, error: applicationContextError } = await sb
    .from("applications")
    .select(`
      id,
      applicant_name,
      applicant_email,
      applicant_vector_full_name,
      applicant_vector_email,
      on_call_signup_id,
      on_call_resolution_type,
      on_call_custom_start,
      on_call_custom_end,
      on_call_estimated_hours,
      on_call_note,
      on_call_phone,
      on_call_projected_hours_if_used,
      on_call_would_be_ot
    `)
    .eq("id", appId)
    .single();

  if (applicationContextError) {
    console.error("approval application context error", applicationContextError);
  }

  let onCallSignupContext = null;
  if (applicationContext?.on_call_signup_id) {
    const { data: signupCtx, error: signupCtxErr } = await sb
      .from("on_call_signups")
      .select("*")
      .eq("id", applicationContext.on_call_signup_id)
      .maybeSingle();
    if (signupCtxErr) console.error("approval on-call signup context error", signupCtxErr);
    onCallSignupContext = signupCtx || null;
  }

  const resolvedOnCallType = firstNonEmpty(applicationContext?.on_call_resolution_type, onCallSignupContext?.extra_availability_type);
  const resolvedOnCallStart = firstNonEmpty(applicationContext?.on_call_custom_start, onCallSignupContext?.custom_start);
  const resolvedOnCallEnd = firstNonEmpty(applicationContext?.on_call_custom_end, onCallSignupContext?.custom_end);
  const resolvedOnCallEstimated = numberOrNull(applicationContext?.on_call_estimated_hours) ?? numberOrNull(onCallSignupContext?.estimated_hours);
  const baseShiftLength = shiftLengthFor(shiftContext);
  const resolvedOnCallTotal = onCallTotalHoursForApproval(resolvedOnCallType, baseShiftLength, resolvedOnCallEstimated);
  const resolvedOnCallProjected = numberOrNull(applicationContext?.on_call_projected_hours_if_used) ?? numberOrNull(onCallSignupContext?.projected_hours_if_used);

  if (applicationContext?.on_call_signup_id) {
    try {
      await sb.from("applications").update({
        on_call_resolution_type: applicationContext?.on_call_resolution_type || resolvedOnCallType || null,
        on_call_custom_start: applicationContext?.on_call_custom_start || resolvedOnCallStart || null,
        on_call_custom_end: applicationContext?.on_call_custom_end || resolvedOnCallEnd || null,
        on_call_estimated_hours: applicationContext?.on_call_estimated_hours ?? resolvedOnCallEstimated ?? null,
        on_call_phone: applicationContext?.on_call_phone || onCallSignupContext?.phone || null,
        on_call_note: applicationContext?.on_call_note || onCallSignupContext?.note || null,
        on_call_projected_hours_if_used: applicationContext?.on_call_projected_hours_if_used ?? resolvedOnCallProjected ?? null,
        on_call_would_be_ot: applicationContext?.on_call_would_be_ot || (resolvedOnCallProjected != null ? resolvedOnCallProjected > 40 : false),
        on_call_approval_mode: onCallApprovalMode,
        on_call_lc_custom_start: onCallApprovalMode === "lc_custom" ? onCallCustomStart || null : null,
        on_call_lc_custom_end: onCallApprovalMode === "lc_custom" ? onCallCustomEnd || null : null,
        on_call_lc_instructions: onCallApprovalMode === "lc_custom" ? onCallCustomInstructions || null : null,
        on_call_approved_at: new Date().toISOString(),
      }).eq("id", appId);

      await sb.from("on_call_signups").update({
        status: "used",
        related_shift_id: shiftId,
        related_application_id: appId,
        used_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        on_call_approval_mode: onCallApprovalMode,
        on_call_lc_custom_start: onCallApprovalMode === "lc_custom" ? onCallCustomStart || null : null,
        on_call_lc_custom_end: onCallApprovalMode === "lc_custom" ? onCallCustomEnd || null : null,
        on_call_lc_instructions: onCallApprovalMode === "lc_custom" ? onCallCustomInstructions || null : null,
        on_call_approved_at: new Date().toISOString(),
        todo_complete: false,
      }).eq("id", applicationContext.on_call_signup_id).eq("status", "active");
    } catch (onCallErr) {
      console.error("approval on-call marking error", onCallErr);
    }
  }

  let currentHoursRefresh = null;
  try {
    if (applicationContext?.applicant_email && shiftContext?.date) {
      currentHoursRefresh = await refreshCurrentHoursForApplicantWeek({
        sb,
        applicantEmail: applicationContext.applicant_email,
        applicantName: applicationContext.applicant_vector_full_name || applicationContext.applicant_name,
        shiftDate: shiftContext.date,
        includeStatuses: ["pending"],
      });
    }
  } catch (refreshErr) {
    console.error("post-approval current hours refresh error", refreshErr);
    currentHoursRefresh = {
      success: false,
      error: refreshErr.message || "Could not refresh other pending applications after approval.",
    };
  }

  const notificationContext = {
    ...data,

    // Approved/applicant person: prefer Vector-matched full name.
    approved_name:
      applicationContext?.applicant_vector_full_name ||
      data.approved_name,
    approved_email:
      applicationContext?.applicant_vector_email ||
      data.approved_email,
    approved_vector_full_name:
      applicationContext?.applicant_vector_full_name || null,

    // Shift/poster context: prefer fresh shift row.
    vector_source: shiftContext?.vector_source || data.vector_source || null,
    is_lc_override:
      shiftContext?.vector_source === "lc_override" ||
      data.vector_source === "lc_override",

    poster_name: shiftContext?.poster_name || data.poster_name,
    poster_email: shiftContext?.poster_email || data.poster_email,
    poster_vector_full_name: shiftContext?.poster_vector_full_name || null,

    shift_type: shiftContext?.type || data.shift_type,
    shift_time: shiftContext?.time || data.shift_time,
    shift_date: shiftContext?.date || data.shift_date,

    is_swap: shiftContext?.is_swap ?? data.is_swap,
    swap_partner_name: shiftContext?.swap_partner_name || data.swap_partner_name,
    swap_partner_email: shiftContext?.swap_partner_email || data.swap_partner_email,
    swap_partner_type: shiftContext?.swap_partner_type || data.swap_partner_type,
    swap_partner_time: shiftContext?.swap_partner_time || data.swap_partner_time,
    swap_partner_date: shiftContext?.swap_partner_date || data.swap_partner_date,
    swap_partner_vector_full_name:
      shiftContext?.swap_partner_vector_full_name || null,

    on_call_signup_id: applicationContext?.on_call_signup_id || null,
    on_call_resolution_type: resolvedOnCallType || null,
    on_call_custom_start: resolvedOnCallStart || null,
    on_call_custom_end: resolvedOnCallEnd || null,
    on_call_estimated_hours: resolvedOnCallEstimated ?? null,
    on_call_note: applicationContext?.on_call_note || onCallSignupContext?.note || null,
    on_call_phone: applicationContext?.on_call_phone || onCallSignupContext?.phone || null,
    on_call_projected_hours_if_used: resolvedOnCallProjected ?? null,
    on_call_would_be_ot: applicationContext?.on_call_would_be_ot || (resolvedOnCallProjected != null ? resolvedOnCallProjected > 40 : false),
    on_call_approval_mode: onCallApprovalMode,
    on_call_lc_custom_start: onCallCustomStart || null,
    on_call_lc_custom_end: onCallCustomEnd || null,
    on_call_lc_instructions: onCallCustomInstructions || null,
  };

  const emailOn = isEmailEnabled();
  const notifs = buildApprovalNotifications(notificationContext);
  const emailResults = [];

  for (const notification of notifs) {
    if (!emailOn) {
      const insertResult = await insertNotificationRow(sb, {
        ...notification,
        status: "skipped",
        related_shift_id: shiftId,
        related_application_id: appId,
      });

      emailResults.push({
        recipient_email: notification.recipient_email,
        type: notification.type,
        status: insertResult.error ? "insert_failed" : "skipped",
        error: insertResult.error?.message || null,
      });

      continue;
    }

    try {
      const gmailResult = await sendNotificationEmail(notification);

      const insertResult = await insertNotificationRow(sb, {
        ...notification,
        status: "sent",
        sent_at: new Date().toISOString(),
        related_shift_id: shiftId,
        related_application_id: appId,
      });

      emailResults.push({
        recipient_email: notification.recipient_email,
        type: notification.type,
        status: insertResult.error ? "sent_but_insert_failed" : "sent",
        gmail_id: gmailResult?.id || null,
        error: insertResult.error?.message || null,
      });
    } catch (sendErr) {
      console.error("approval email send error", sendErr);

      const insertResult = await insertNotificationRow(sb, {
        ...notification,
        status: "failed",
        error_message: sendErr.message || "Email send failed",
        related_shift_id: shiftId,
        related_application_id: appId,
      });

      emailResults.push({
        recipient_email: notification.recipient_email,
        type: notification.type,
        status: insertResult.error ? "send_failed_and_insert_failed" : "failed",
        error: sendErr.message || "Email send failed",
        insert_error: insertResult.error?.message || null,
      });
    }
  }

  const sentCount = emailResults.filter((r) =>
    ["sent", "sent_but_insert_failed"].includes(r.status)
  ).length;

  const failedCount = emailResults.filter((r) =>
    ["failed", "send_failed_and_insert_failed", "insert_failed"].includes(r.status)
  ).length;

  return NextResponse.json({
    success: true,
    approved_name: notificationContext.approved_name,
    emailEnabled: emailOn,
    notificationsBuilt: notifs.length,
    emailStatus: emailOn
      ? failedCount
        ? "partial_or_failed"
        : sentCount
          ? "sent"
          : "no_notifications"
      : "not_configured",
    emailSummary: {
      sent: sentCount,
      failed: failedCount,
      results: emailResults,
    },
    currentHoursRefresh,
  });
}
