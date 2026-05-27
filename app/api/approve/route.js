import { NextResponse } from "next/server";
import { requireLC } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase-server";
import { buildApprovalNotifications } from "@/lib/notifications";
import { isEmailEnabled, sendNotificationEmail } from "@/lib/gmail";

async function insertNotificationRows(sb, rows) {
  if (!rows.length) return { error: null };
  const { error } = await sb.from("notifications").insert(rows);
  if (error) console.error("notifications insert error", error);
  return { error };
}

export async function POST(req) {
  const err = await requireLC();
  if (err) return NextResponse.json(err, { status: err.status });

  const { shiftId, appId } = await req.json();
  if (!shiftId || !appId) {
    return NextResponse.json({ success: false, error: "Missing fields" }, { status: 400 });
  }

  const sb = getServiceClient();

  const { data, error } = await sb.rpc("approve_application", {
    p_shift_id: shiftId,
    p_app_id: appId,
  });

  if (error) {
    console.error(error);
    return NextResponse.json({ success: false, error: "Database error" }, { status: 500 });
  }

  if (!data?.success) return NextResponse.json(data, { status: 400 });

  const emailOn = isEmailEnabled();
  const notifs = buildApprovalNotifications(data);

  const emailResults = [];

  if (notifs.length) {
    if (emailOn) {
      for (const notification of notifs) {
        try {
          const gmailResult = await sendNotificationEmail(notification);
          emailResults.push({
            recipient_email: notification.recipient_email,
            status: "sent",
            gmail_id: gmailResult?.id || null,
          });

          await insertNotificationRows(sb, [{
            ...notification,
            status: "sent",
            related_shift_id: shiftId,
            related_application_id: appId,
          }]);
        } catch (sendErr) {
          console.error("approval email send error", sendErr);

          emailResults.push({
            recipient_email: notification.recipient_email,
            status: "failed",
            error: sendErr.message || "Email send failed",
          });

          // Keep approval successful even if email fails.
          await insertNotificationRows(sb, [{
            ...notification,
            status: "failed",
            related_shift_id: shiftId,
            related_application_id: appId,
          }]);
        }
      }
    } else {
      await insertNotificationRows(sb, notifs.map(n => ({
        ...n,
        status: "skipped",
        related_shift_id: shiftId,
        related_application_id: appId,
      })));
    }
  }

  const sentCount = emailResults.filter(r => r.status === "sent").length;
  const failedCount = emailResults.filter(r => r.status === "failed").length;

  return NextResponse.json({
    success: true,
    approved_name: data.approved_name,
    emailStatus: emailOn ? (failedCount ? "partial_or_failed" : "sent") : "not_configured",
    emailSummary: emailOn
      ? { sent: sentCount, failed: failedCount, results: emailResults }
      : { sent: 0, failed: 0, results: [] },
  });
}
