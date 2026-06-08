import { NextResponse } from "next/server";
import { requireLC } from "@/lib/auth";
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

export async function POST(req) {
  const err = await requireLC();
  if (err) return NextResponse.json(err, { status: err.status });

  const { shiftId, appId } = await req.json();

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
      is_swap,
      swap_partner_name,
      swap_partner_email,
      swap_partner_type,
      swap_partner_time,
      swap_partner_date,
      swap_partner_vector_full_name
    `)
    .eq("id", shiftId)
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
      applicant_vector_email
    `)
    .eq("id", appId)
    .single();

  if (applicationContextError) {
    console.error("approval application context error", applicationContextError);
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
