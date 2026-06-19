import { NextResponse } from "next/server";
import { requireLakefrontLC as requireLC } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase-server";
import { buildOnCallApprovalNotification } from "@/lib/notifications";
import { isEmailEnabled, sendNotificationEmail } from "@/lib/gmail";

async function insertNotificationRow(sb, row) {
  const { error } = await sb.from("notifications").insert(row);
  if (error) {
    console.error("notifications insert error", error);
    return { error };
  }
  return { error: null };
}

export async function POST(req) {
  const authErr = await requireLC();
  if (authErr) return NextResponse.json(authErr, { status: authErr.status || 401 });

  try {
    const body = await req.json();
    const id = body.id;
    const mode = ["use_on_call", "lc_custom"].includes(body.mode) ? body.mode : "use_on_call";
    const customStart = String(body.customStart || "").trim();
    const customEnd = String(body.customEnd || "").trim();
    const instructions = String(body.instructions || "").trim();

    if (!id) return NextResponse.json({ success: false, error: "Missing On-Call ID." }, { status: 400 });
    if (mode === "lc_custom" && !customStart && !customEnd && !instructions) {
      return NextResponse.json({ success: false, error: "Add a custom time or instruction before using LC custom approval." }, { status: 400 });
    }

    const sb = getServiceClient();
    const now = new Date().toISOString();

    const { data: updated, error: updateErr } = await sb
      .from("on_call_signups")
      .update({
        status: "used",
        used_at: now,
        updated_at: now,
        on_call_approval_mode: mode,
        on_call_lc_custom_start: mode === "lc_custom" ? customStart || null : null,
        on_call_lc_custom_end: mode === "lc_custom" ? customEnd || null : null,
        on_call_lc_instructions: mode === "lc_custom" ? instructions || null : null,
        on_call_approved_at: now,
        todo_complete: false,
      })
      .eq("id", id)
      .eq("status", "active")
      .select("*")
      .maybeSingle();

    if (updateErr) throw updateErr;
    if (!updated) return NextResponse.json({ success: false, error: "Could not find an active On-Call signup." }, { status: 404 });

    const notification = buildOnCallApprovalNotification(updated);
    const emailOn = isEmailEnabled();
    let emailStatus = "not_configured";
    let emailResult = null;

    if (!emailOn) {
      const insertResult = await insertNotificationRow(sb, { ...notification, status: "skipped" });
      emailResult = { status: insertResult.error ? "insert_failed" : "skipped", error: insertResult.error?.message || null };
    } else {
      try {
        const sent = await sendNotificationEmail(notification);
        const insertResult = await insertNotificationRow(sb, { ...notification, status: "sent", sent_at: now });
        emailStatus = insertResult.error ? "sent_but_insert_failed" : "sent";
        emailResult = { status: emailStatus, gmail_id: sent?.id || null, error: insertResult.error?.message || null };
      } catch (sendErr) {
        console.error("on-call approval email send error", sendErr);
        const insertResult = await insertNotificationRow(sb, { ...notification, status: "failed", error_message: sendErr.message || "Email send failed" });
        emailStatus = "failed";
        emailResult = { status: insertResult.error ? "send_failed_and_insert_failed" : "failed", error: sendErr.message || "Email send failed", insert_error: insertResult.error?.message || null };
      }
    }

    return NextResponse.json({ success: true, signup: updated, emailEnabled: emailOn, emailStatus, emailResult });
  } catch (err) {
    console.error("on-call approve error", err);
    return NextResponse.json({ success: false, error: err.message || "Could not approve On-Call signup." }, { status: 500 });
  }
}
