import { NextResponse } from "next/server";
import { requireLC } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase-server";
import { buildApprovalNotifications } from "@/lib/notifications";

export async function POST(req) {
  const err = await requireLC();
  if (err) return NextResponse.json(err, { status: err.status });

  const { shiftId, appId } = await req.json();
  if (!shiftId || !appId) return NextResponse.json({ success: false, error: "Missing fields" }, { status: 400 });

  const sb = getServiceClient();
  const { data, error } = await sb.rpc("approve_application", { p_shift_id: shiftId, p_app_id: appId });
  if (error) { console.error(error); return NextResponse.json({ success: false, error: "Database error" }, { status: 500 }); }
  if (!data?.success) return NextResponse.json(data, { status: 400 });

  const emailOn = process.env.EMAIL_ENABLED === "true";
  const notifs = buildApprovalNotifications(data);
  if (notifs.length) {
    await sb.from("notifications").insert(notifs.map(n => ({
      ...n, status: emailOn ? "pending" : "skipped",
      related_shift_id: shiftId, related_application_id: appId,
    })));
  }

  return NextResponse.json({ success: true, approved_name: data.approved_name, emailStatus: emailOn ? "pending" : "not_configured" });
}
